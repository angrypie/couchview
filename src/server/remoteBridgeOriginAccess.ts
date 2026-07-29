import {
  REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
  remoteBridgeOriginAccessIdIsValid,
} from "../shared/contracts.ts";

export interface RemoteBridgeOriginAccessRequestOptions {
  interactive?: boolean;
  refresh?: boolean;
}

export interface RemoteBridgeOriginAccessSession {
  requestHeaders(
    options?: RemoteBridgeOriginAccessRequestOptions,
  ): Promise<Record<string, string>>;
}

/**
 * Adds edge or gateway authentication without changing Couchview's pairing,
 * ticket, signaling, lease, SSH, or WebRTC protocols.
 */
export interface RemoteBridgeOriginAccessProvider {
  readonly id: string;
  createSession(origin: string): RemoteBridgeOriginAccessSession;
}

const noOriginAccessProvider: RemoteBridgeOriginAccessProvider = {
  id: REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
  createSession: () => ({
    requestHeaders: async () => ({}),
  }),
};

export function remoteBridgeOriginAccessSession(
  id: string,
  origin: string,
  providers: readonly RemoteBridgeOriginAccessProvider[],
): RemoteBridgeOriginAccessSession {
  if (!remoteBridgeOriginAccessIdIsValid(id)) {
    throw new Error(`The Couchview bridge origin-access provider '${id}' is invalid`);
  }
  const candidates = [noOriginAccessProvider, ...providers];
  const provider = candidates.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error(
      `The Couchview bridge origin-access provider '${id}' is not installed on this device`,
    );
  }
  return provider.createSession(origin);
}
