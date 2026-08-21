#include "HybridOniguruma.hpp"

#include <NitroModules/HybridObjectRegistry.hpp>

#include <cstdint>
#include <stdexcept>

namespace nitro_onig {

using namespace margelo::nitro;

// ---------------------------------------------------------------------------
// HybridOnigString
// ---------------------------------------------------------------------------

HybridOnigString::HybridOnigString(const std::string& text, double utf16Length)
	: HybridObject(TAG), line(std::shared_ptr<OnigLine>(createOnigLine(text, static_cast<int32_t>(utf16Length)))), utf16Length(utf16Length) {
	// Monotonic ids never repeat, so the per-pattern long-string cache cannot
	// collide across different strings (same guarantee as WASM OnigString.id).
	static int32_t nextStringId = 1;
	stringId = nextStringId++;
}

void HybridOnigString::dispose() {
	line.reset();
}

size_t HybridOnigString::getExternalMemorySize() noexcept {
	if (line == nullptr) return 0;
	return line->utf8.capacity() + (line->utf8ToUtf16.capacity() + line->utf16ToUtf8.capacity()) * sizeof(int32_t);
}

// ---------------------------------------------------------------------------
// HybridOnigScanner
// ---------------------------------------------------------------------------

HybridOnigScanner::HybridOnigScanner(const std::vector<std::string>& patterns) : HybridObject(TAG) {
	std::string error;
	_scanner = createOnigScanner(patterns, error);
	if (_scanner == nullptr) {
		throw std::runtime_error(error.empty() ? "Oniguruma pattern compilation failed" : error);
	}
}

std::optional<std::shared_ptr<ArrayBuffer>> HybridOnigScanner::findNextMatchSync(
	const std::shared_ptr<HybridOnigString>& text,
	double startPosition,
	double options
) {
	if (text == nullptr || text->line == nullptr) {
		return std::nullopt;
	}
	const int32_t* encoded = nullptr;
	int32_t length = 0;
	const bool matched = findNextMatch(
		_scanner,
		text->line.get(),
		static_cast<int32_t>(startPosition),
		static_cast<int32_t>(options),
		text->stringId,
		encoded,
		length
	);
	if (!matched) {
		return std::nullopt;
	}
	const size_t bytes = static_cast<size_t>(length) * sizeof(int32_t);
	auto* copy = static_cast<int32_t*>(malloc(bytes));
	memcpy(copy, encoded, bytes);
	return std::make_optional(ArrayBuffer::wrap(reinterpret_cast<uint8_t*>(copy), bytes, [copy]() {
		free(copy);
	}));
}

void HybridOnigScanner::dispose() {
	freeOnigScanner(_scanner);
	_scanner = nullptr;
}

void HybridOnigScanner::loadHybridMethods() {
	HybridObject::loadHybridMethods();
	registerHybrids(this, [](Prototype& prototype) {
		prototype.registerHybridMethod("findNextMatchSync", &HybridOnigScanner::findNextMatchSync);
	});
}

size_t HybridOnigScanner::getExternalMemorySize() noexcept {
	if (_scanner == nullptr) return 0;
	size_t size = _scanner->encoded.capacity() * sizeof(int32_t);
	for (const auto* regexp : _scanner->regexes) {
		size += regexp->pattern.capacity();
		// regex_t is opaque here; its bytecode lives in Oniguruma's heap and
		// is proportional to the pattern length, so count pattern bytes
		// twice as a conservative estimate.
		size += regexp->pattern.capacity();
		if (regexp->region != nullptr) {
			size += sizeof(OnigRegion) + sizeof(int32_t) * 2 * static_cast<size_t>(regexp->region->allocated);
		}
	}
	return size;
}

// ---------------------------------------------------------------------------
// HybridOniguruma
// ---------------------------------------------------------------------------

std::shared_ptr<HybridOnigScanner> HybridOniguruma::createScanner(const std::vector<std::string>& patterns) {
	return std::make_shared<HybridOnigScanner>(patterns);
}

std::shared_ptr<HybridOnigString> HybridOniguruma::createString(const std::string& text, double utf16Length) {
	return std::make_shared<HybridOnigString>(text, utf16Length);
}

void HybridOniguruma::loadHybridMethods() {
	HybridObject::loadHybridMethods();
	registerHybrids(this, [](Prototype& prototype) {
		prototype.registerHybridMethod("createScanner", &HybridOniguruma::createScanner);
		prototype.registerHybridMethod("createString", &HybridOniguruma::createString);
	});
}

} // namespace nitro_onig
