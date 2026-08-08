import CoreML
import Darwin
import FluidAudio
import Foundation
import NaturalLanguage

private let modelName = "parakeet-tdt-0.6b-v3-int8"

private struct Request: Decodable {
	let type: String
	let id: String
	let audioPath: String
}

private struct ReadyResponse: Encodable {
	let type = "ready"
	let model = modelName
}

private struct ResultResponse: Encodable {
	let type = "result"
	let id: String
	let ok: Bool
	let text: String?
	let language: String?
	let inferenceMs: Int?
	let message: String?
}

private struct FatalResponse: Encodable {
	let type = "fatal"
	let message: String
}

private final class ProtocolWriter: @unchecked Sendable {
	private let handle: FileHandle
	private let encoder = JSONEncoder()
	private let lock = NSLock()

	init() throws {
		let protocolDescriptor = dup(STDOUT_FILENO)
		guard protocolDescriptor >= 0 else {
			throw POSIXError(.EBADF)
		}
		// FluidAudio diagnostics must never enter the NDJSON protocol stream.
		guard dup2(STDERR_FILENO, STDOUT_FILENO) >= 0 else {
			close(protocolDescriptor)
			throw POSIXError(.EBADF)
		}
		handle = FileHandle(fileDescriptor: protocolDescriptor, closeOnDealloc: true)
	}

	func write<T: Encodable>(_ value: T) throws {
		let data = try encoder.encode(value)
		lock.lock()
		defer { lock.unlock() }
		try handle.write(contentsOf: data)
		try handle.write(contentsOf: Data([0x0A]))
	}
}

@main
private enum CouchviewSpeechSidecar {
	static func main() async {
		var protocolWriter: ProtocolWriter?
		do {
			let writer = try ProtocolWriter()
			protocolWriter = writer
			let manager = try await loadManager()
			try await warm(manager)
			try writer.write(ReadyResponse())
			await serve(manager: manager, writer: writer)
		} catch {
			// Initialization failures are intentionally content-free.
			try? protocolWriter?.write(FatalResponse(message: String(describing: error)))
			exit(EXIT_FAILURE)
		}
	}

	private static func loadManager() async throws -> AsrManager {
		let configuration = MLModelConfiguration()
		configuration.computeUnits = .cpuAndNeuralEngine
		let models = try await AsrModels.downloadAndLoad(
			configuration: configuration,
			version: .v3,
			encoderPrecision: .int8,
			encoderComputeUnits: .cpuAndNeuralEngine
		)
		let manager = AsrManager(config: ASRConfig(melChunkContext: false))
		try await manager.loadModels(models)
		return manager
	}

	private static func warm(_ manager: AsrManager) async throws {
		var decoderState = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
		_ = try await manager.transcribe(
			Array(repeating: Float.zero, count: 16_000),
			decoderState: &decoderState
		)
	}

	private static func detectedLanguage(in text: String) -> String? {
		guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
		let recognizer = NLLanguageRecognizer()
		recognizer.processString(text)
		return recognizer.dominantLanguage?.rawValue
	}

	private static func serve(manager: AsrManager, writer: ProtocolWriter) async {
		while let line = readLine(strippingNewline: true) {
			do {
				guard let data = line.data(using: .utf8) else { continue }
				let request = try JSONDecoder().decode(Request.self, from: data)
				guard request.type == "transcribe" else { continue }
				let start = ContinuousClock.now
				var decoderState = TdtDecoderState.make(
					decoderLayers: await manager.decoderLayerCount
				)
				let result = try await manager.transcribe(
					URL(fileURLWithPath: request.audioPath),
					decoderState: &decoderState
				)
				let elapsed = start.duration(to: .now)
				let inferenceMs = Int(elapsed.components.seconds * 1_000) +
					Int(elapsed.components.attoseconds / 1_000_000_000_000_000)
				try writer.write(
					ResultResponse(
						id: request.id,
						ok: true,
						text: result.text,
						language: detectedLanguage(in: result.text),
						inferenceMs: inferenceMs,
						message: nil
					)
				)
			} catch {
				let id = (try? requestId(from: line)) ?? "unknown"
				try? writer.write(
					ResultResponse(
						id: id,
						ok: false,
						text: nil,
						language: nil,
						inferenceMs: nil,
						message: String(describing: error)
					)
				)
			}
		}
	}

	private static func requestId(from line: String) throws -> String {
		guard let data = line.data(using: .utf8) else { return "unknown" }
		return try JSONDecoder().decode(Request.self, from: data).id
	}
}
