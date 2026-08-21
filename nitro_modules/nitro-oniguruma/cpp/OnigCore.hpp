#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "oniguruma.h"

namespace nitro_onig {

/**
 * Pure C++ Oniguruma scanner core, shared by the Nitro hybrid objects and the
 * host FFI parity harness. Semantics mirror vscode-oniguruma 1.7.0's WASM
 * binding (onig.cc) byte-for-byte: same compile options, same leftmost-match
 * selection with lowest-pattern-index tie-break, same RegSet fast path for
 * short strings, same capture encoding and unmatched-group sentinel.
 */

// Finder options, identical bit layout to vscode-oniguruma.
enum : int32_t {
	kFindOptionNone = 0,
	kFindOptionNotBeginString = 1,
	kFindOptionNotEndString = 2,
	kFindOptionNotBeginPosition = 4,
};

constexpr int32_t kMaxRegions = 1000;

struct OnigRegExp {
	std::string pattern;
	regex_t* regex = nullptr;
	OnigRegion* region = nullptr;
	bool hasGAnchor = false;
	int32_t lastSearchStrCacheId = 0;
	int32_t lastSearchPosition = 0;
	OnigOptionType lastSearchOnigOption = ONIG_OPTION_NONE;
	bool lastSearchMatched = false;
};

struct OnigScanner {
	OnigRegSet* rset = nullptr;
	std::vector<OnigRegExp*> regexes;
	// Encoded result: [patternIndex, captureCount, beg0, end0, beg1, end1, ...]
	// in UTF-16 code units. Capacity sized from the max capture count at
	// compile time.
	std::vector<int32_t> encoded;
};

struct OnigLine {
	// The line encoded as UTF-8 plus UTF-16 <-> UTF-8 offset maps. Maps are
	// empty when every byte maps 1:1 (pure ASCII).
	std::string utf8;
	int32_t utf16Length = 0;
	std::vector<int32_t> utf8ToUtf16;
	std::vector<int32_t> utf16ToUtf8;

	bool isAscii() const {
		return utf8ToUtf16.empty();
	}
	int32_t utf16ToUtf8Offset(int32_t position) const;
	int32_t utf8ToUtf16Offset(int32_t offset) const;
};

// Compiles all patterns in order. On failure, frees everything and writes the
// Oniguruma error message to `errorOut`, returning null.
OnigScanner* createOnigScanner(const std::vector<std::string>& patterns, std::string& errorOut);

void freeOnigScanner(OnigScanner* scanner);

// Builds the UTF-8 buffer and offset maps for a JS string's code units.
OnigLine* createOnigLine(const std::string& utf8, int32_t utf16Length);
void freeOnigLine(OnigLine* line);

// Searches all patterns for the leftmost match at or after `utf16Position`
// (in UTF-16 code units). Returns false when nothing matches. On success,
// `encodedOut` points into `scanner->encoded` (valid until the next search on
// this scanner) and `lengthOut` is the number of encoded int32 values.
bool findNextMatch(
	OnigScanner* scanner,
	const OnigLine* line,
	int32_t utf16Position,
	int32_t options,
	int32_t strCacheId,
	const int32_t*& encodedOut,
	int32_t& lengthOut
);

} // namespace nitro_onig
