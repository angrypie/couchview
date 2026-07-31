import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Copy,
  ExternalLink,
  Laptop,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import type {
  RemoteBridgeCapability,
  RemoteBridgeDevice,
  RemoteBridgePairingResponse,
} from "../shared/contracts.ts";
import {
  remoteBridgeClaudeCommand,
  remoteBridgeCodexCommand,
  remoteBridgeTerminalCommand,
  remoteBridgeZedCommand,
  remoteBridgeZedUrl,
} from "../shared/remoteBridgeCommands.ts";
import { api } from "./api.ts";

interface RemoteBridgeSheetProps {
  capability: RemoteBridgeCapability;
  csrfToken: string;
  open: boolean;
  repositoryId: string;
  repositoryName: string;
  repositoryRoot: string;
  onClose(): void;
  onNotice(message: string): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The native bridge request failed.";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for local HTTP and older browsers.
    }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy was blocked. Select and copy the command manually.");
}

function formatDeviceTime(value: string | null): string {
  if (!value) return "Never connected";
  return `Last used ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))}`;
}

export function RemoteBridgeSheet({
  capability,
  csrfToken,
  open,
  repositoryId,
  repositoryName,
  repositoryRoot,
  onClose,
  onNotice,
}: RemoteBridgeSheetProps) {
  const [devices, setDevices] = useState<RemoteBridgeDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [label, setLabel] = useState("My Mac");
  const [pairing, setPairing] = useState<RemoteBridgePairingResponse | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!capability.available) return;
    setLoading(true);
    try {
      const response = await api.remoteBridgeDevices(repositoryId, signal);
      setDevices(response.devices);
      setError("");
      setPairing((current) =>
        current && response.devices.some((device) => device.sshAlias === current.sshAlias)
          ? null
          : current
      );
    } catch (nextError) {
      if (!signal?.aborted) setError(messageOf(nextError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [capability.available, repositoryId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !pairing) return;
    const expiresAt = new Date(pairing.expiresAt).getTime();
    const interval = window.setInterval(() => {
      if (Date.now() >= expiresAt) {
        setPairing(null);
        setError("That pairing command expired. Generate a new one to continue.");
        return;
      }
      void refresh();
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [open, pairing, refresh]);

  const enableCommand = useMemo(() => {
    const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
    return `couchview serve ${quote(repositoryRoot)} --enable-remote-bridge --enable-remote-bridge-p2p`;
  }, [repositoryRoot]);

  const createPairing = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.createRemoteBridgePairing(
        repositoryId,
        { label: label.trim() },
        csrfToken,
      );
      setPairing(response);
      onNotice("Pairing command created");
    } catch (nextError) {
      setError(messageOf(nextError));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: RemoteBridgeDevice) => {
    if (revokingId) return;
    if (!window.confirm(`Revoke native IDE access for ${device.label}?`)) return;
    setRevokingId(device.id);
    setError("");
    try {
      await api.revokeRemoteBridgeDevice(
        repositoryId,
        device.id,
        csrfToken,
      );
      setDevices((current) => current.filter((candidate) => candidate.id !== device.id));
      onNotice(`Revoked ${device.label}`);
    } catch (nextError) {
      setError(messageOf(nextError));
    } finally {
      setRevokingId(null);
    }
  };

  if (!open) return null;

  return (
    <>
      <button
        aria-label="Close native IDE setup"
        className="sheet-scrim"
        onClick={onClose}
        type="button"
      />
      <section
        aria-label="Native IDE setup"
        aria-modal="true"
        className="bottom-sheet remote-bridge-sheet"
        role="dialog"
      >
        <span className="sheet-grabber" />
        <header className="sheet-header">
          <div>
            <h2 className="sheet-title">Native IDE</h2>
            <div className="repo-meta">{repositoryName} on this Mac</div>
          </div>
          <button
            aria-label="Close native IDE setup"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={19} />
          </button>
        </header>

        <div className="remote-bridge-scroll">
          <div className="remote-bridge-status">
            <ShieldCheck size={18} />
            <div>
              <strong>
                {capability.p2pEnabled
                  ? "Direct WebRTC preferred"
                  : "Protected WebSocket transport"}
              </strong>
              <span>
                {capability.p2pEnabled
                  ? "The configured origin carries signaling and automatic fallback."
                  : "IDE traffic stays on the Couchview origin WebSocket."}
              </span>
            </div>
          </div>

          {!capability.available ? (
            <section className="remote-bridge-card">
              <h3>Enable on the Couchview Mac</h3>
              <p>{capability.reason}</p>
              <p>
                Enable macOS Remote Login, stop this Couchview process, then relaunch it with
                these flags. Do not start a second server on the same port.
              </p>
              <pre className="remote-bridge-command">{enableCommand}</pre>
              <button
                className="action-button secondary"
                onClick={() => void copyText(enableCommand)
                  .then(() => onNotice("Enable command copied"))
                  .catch((nextError) => setError(messageOf(nextError)))}
                type="button"
              >
                <Copy size={15} /> Copy next-launch command
              </button>
            </section>
          ) : (
            <>
              <section className="remote-bridge-card">
                <div className="remote-bridge-card-heading">
                  <div>
                    <h3>Paired Macs</h3>
                    <p>
                      Pair once, then use the same Mac with every repository registered here.
                    </p>
                  </div>
                  <button
                    aria-label="Refresh paired Macs"
                    className="icon-button"
                    disabled={loading}
                    onClick={() => void refresh()}
                    type="button"
                  >
                    <RefreshCw className={loading ? "spinner" : ""} size={16} />
                  </button>
                </div>
                <div className="remote-bridge-devices">
                  {devices.map((device) => {
                    const zedUrl = remoteBridgeZedUrl(
                      device.sshAlias,
                      repositoryRoot,
                    );
                    const zedCommand = remoteBridgeZedCommand(
                      device.sshAlias,
                      repositoryRoot,
                    );
                    const codexCommand = remoteBridgeCodexCommand(
                      device.sshAlias,
                      repositoryRoot,
                    );
                    const terminalCommand = remoteBridgeTerminalCommand(
                      device.sshAlias,
                      repositoryRoot,
                    );
                    const claudeCommand = remoteBridgeClaudeCommand(
                      device.sshAlias,
                      repositoryRoot,
                    );
                    return (
                      <div className="remote-bridge-device" key={device.id}>
                        <Laptop className="remote-bridge-device-icon" size={18} />
                        <div className="remote-bridge-device-meta">
                          <strong>{device.label}</strong>
                          <span>{formatDeviceTime(device.lastUsedAt)}</span>
                        </div>
                        <button
                          aria-label={`Revoke ${device.label}`}
                          className="icon-button remote-bridge-revoke"
                          disabled={revokingId !== null}
                          onClick={() => void revoke(device)}
                          type="button"
                        >
                          {revokingId === device.id ? (
                            <LoaderCircle className="spinner" size={16} />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                        <div className="remote-bridge-device-commands">
                          <div className="remote-bridge-launch-heading">
                            <strong>Zed</strong>
                            <a
                              className="remote-bridge-open"
                              href={zedUrl}
                              title={`Open ${repositoryName} through ${device.sshAlias}`}
                            >
                              <ExternalLink size={13} /> Open
                            </a>
                            <button
                              aria-label={`Copy Zed command for ${device.label}`}
                              className="icon-button remote-bridge-copy"
                              onClick={() => void copyText(zedCommand)
                                .then(() => onNotice("Zed command copied"))
                                .catch((nextError) => setError(messageOf(nextError)))}
                              title="Copy Zed command"
                              type="button"
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                          <pre className="remote-bridge-command">{zedCommand}</pre>
                          <div className="remote-bridge-launch-heading">
                            <strong>Codex</strong>
                            <button
                              aria-label={`Copy Codex command for ${device.label}`}
                              className="icon-button remote-bridge-copy"
                              onClick={() => void copyText(codexCommand)
                                .then(() => onNotice("Codex command copied"))
                                .catch((nextError) => setError(messageOf(nextError)))}
                              title="Copy Codex command"
                              type="button"
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                          <pre className="remote-bridge-command">{codexCommand}</pre>
                          <div className="remote-bridge-launch-heading">
                            <strong>Terminal</strong>
                            <button
                              aria-label={`Copy terminal command for ${device.label}`}
                              className="icon-button remote-bridge-copy"
                              onClick={() => void copyText(terminalCommand)
                                .then(() => onNotice("Terminal command copied"))
                                .catch((nextError) => setError(messageOf(nextError)))}
                              title="Copy terminal command"
                              type="button"
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                          <pre className="remote-bridge-command">{terminalCommand}</pre>
                          <div className="remote-bridge-launch-heading">
                            <strong>Claude Code Remote Control</strong>
                            <button
                              aria-label={`Copy Claude Code Remote Control command for ${device.label}`}
                              className="icon-button remote-bridge-copy"
                              onClick={() => void copyText(claudeCommand)
                                .then(() => onNotice("Claude Code Remote Control command copied"))
                                .catch((nextError) => setError(messageOf(nextError)))}
                              title="Copy Claude Code Remote Control command"
                              type="button"
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                          <pre className="remote-bridge-command">{claudeCommand}</pre>
                        </div>
                      </div>
                    );
                  })}
                  {!loading && devices.length === 0 && (
                    <p className="remote-bridge-empty">No development Macs are paired yet.</p>
                  )}
                </div>
              </section>

              <section className="remote-bridge-card">
                <h3>{devices.length > 0 ? "Pair another Mac" : "Pair this Mac"}</h3>
                <p>
                  Generate a one-use command and run it once in Terminal on your MacBook Air.
                  The pairing works for every registered repository.
                </p>
                <form className="remote-bridge-form" onSubmit={(event) => void createPairing(event)}>
                  <label htmlFor="remote-bridge-label">Device name</label>
                  <div>
                    <input
                      autoComplete="off"
                      id="remote-bridge-label"
                      maxLength={80}
                      onChange={(event) => setLabel(event.target.value)}
                      value={label}
                    />
                    <button className="action-button" disabled={busy || !label.trim()} type="submit">
                      {busy ? <LoaderCircle className="spinner" size={15} /> : <Plus size={15} />}
                      Generate
                    </button>
                  </div>
                </form>
                {pairing && (
                  <div className="remote-bridge-pairing">
                    <pre className="remote-bridge-command">{pairing.command}</pre>
                    <button
                      className="action-button secondary"
                      onClick={() => void copyText(pairing.command)
                        .then(() => onNotice("Pairing command copied"))
                        .catch((nextError) => setError(messageOf(nextError)))}
                      type="button"
                    >
                      <Copy size={15} /> Copy command
                    </button>
                    <span>
                      Expires {new Intl.DateTimeFormat(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(pairing.expiresAt))}. This panel refreshes when pairing finishes.
                    </span>
                  </div>
                )}
              </section>

              <p className="remote-bridge-footnote">
                The bridge exposes only the Mini’s loopback SSH service. SSH authentication and
                host-key verification still apply; Couchview never stores your SSH private key.
                Revoking a Mac removes its access to every repository on this Couchview host.
              </p>
            </>
          )}
          {error && <div className="remote-bridge-error" role="alert">{error}</div>}
        </div>
      </section>
    </>
  );
}
