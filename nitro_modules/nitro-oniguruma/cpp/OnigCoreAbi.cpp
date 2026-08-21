#include "OnigCore.hpp"

#include <cstring>

// FFI-friendly C ABI over the shared OnigCore. Used by the host parity
// harness (bun:ffi) to drive the exact same scanner code the Nitro module
// runs, and to fuzz it against the WASM engine before device work.

extern "C" {

void* onigabi_scanner_create(
	const char* const* patterns,
	const int32_t* lengths,
	int32_t count,
	char* errorOut,
	int32_t errorOutLen
) {
	std::vector<std::string> patternList;
	patternList.reserve(static_cast<size_t>(count));
	for (int32_t i = 0; i < count; i++) {
		patternList.emplace_back(patterns[i], static_cast<size_t>(lengths[i]));
	}
	std::string error;
	nitro_onig::OnigScanner* scanner = nitro_onig::createOnigScanner(patternList, error);
	if (scanner == nullptr && errorOut != nullptr && errorOutLen > 0) {
		std::strncpy(errorOut, error.c_str(), static_cast<size_t>(errorOutLen) - 1);
		errorOut[errorOutLen - 1] = '\0';
	}
	return scanner;
}

void onigabi_scanner_free(void* scanner) {
	nitro_onig::freeOnigScanner(static_cast<nitro_onig::OnigScanner*>(scanner));
}

void* onigabi_string_create(const char* utf8, int32_t utf8Len, int32_t utf16Len) {
	return nitro_onig::createOnigLine(std::string(utf8, static_cast<size_t>(utf8Len)), utf16Len);
}

void onigabi_string_free(void* line) {
	nitro_onig::freeOnigLine(static_cast<nitro_onig::OnigLine*>(line));
}

// Returns the number of int32 values written into `outBuf`
// ([index, count, beg0, end0, ...]) or 0 when nothing matched.
int32_t onigabi_scanner_find(
	void* scanner,
	void* line,
	int32_t startPosition,
	int32_t options,
	int32_t strCacheId,
	int32_t* outBuf,
	int32_t outBufLen
) {
	const int32_t* encoded = nullptr;
	int32_t length = 0;
	const bool matched = nitro_onig::findNextMatch(
		static_cast<nitro_onig::OnigScanner*>(scanner),
		static_cast<const nitro_onig::OnigLine*>(line),
		startPosition,
		options,
		strCacheId,
		encoded,
		length
	);
	if (!matched) return 0;
	const int32_t copyLength = length < outBufLen ? length : outBufLen;
	std::memcpy(outBuf, encoded, static_cast<size_t>(copyLength) * sizeof(int32_t));
	return copyLength;
}

} // extern "C"
