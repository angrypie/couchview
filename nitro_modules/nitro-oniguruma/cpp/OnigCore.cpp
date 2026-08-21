#include "OnigCore.hpp"

#include <algorithm>
#include <cstdlib>
#include <cstring>

namespace nitro_onig {

namespace {

bool hasGAnchor(const std::string& pattern) {
	for (int32_t pos = 0; pos + 1 < static_cast<int32_t>(pattern.size()); pos++) {
		if (pattern[pos] == '\\' && pattern[pos + 1] == 'G') {
			return true;
		}
	}
	return false;
}

OnigOptionType toOnigOption(int32_t option) {
	OnigOptionType onigOption = ONIG_OPTION_NONE;
	if ((option & kFindOptionNotBeginString) != 0) {
		onigOption |= ONIG_OPTION_NOT_BEGIN_STRING;
	}
	if ((option & kFindOptionNotEndString) != 0) {
		onigOption |= ONIG_OPTION_NOT_END_STRING;
	}
	if ((option & kFindOptionNotBeginPosition) != 0) {
		onigOption |= ONIG_OPTION_NOT_BEGIN_POSITION;
	}
	return onigOption;
}

OnigRegExp* createOnigRegExp(const std::string& pattern, OnigErrorInfo& errorInfo, int& statusOut) {
	regex_t* regex = nullptr;
	const auto* data = reinterpret_cast<const unsigned char*>(pattern.data());
	const auto* end = data + pattern.size();
	statusOut = onig_new(
		&regex,
		data,
		end,
		ONIG_OPTION_CAPTURE_GROUP,
		ONIG_ENCODING_UTF8,
		ONIG_SYNTAX_DEFAULT,
		&errorInfo
	);
	if (statusOut != ONIG_NORMAL) {
		return nullptr;
	}
	auto* result = new OnigRegExp();
	result->pattern = pattern;
	result->regex = regex;
	result->region = onig_region_new();
	result->hasGAnchor = hasGAnchor(pattern);
	result->lastSearchStrCacheId = 0;
	result->lastSearchPosition = 0;
	result->lastSearchOnigOption = ONIG_OPTION_NONE;
	result->lastSearchMatched = false;
	return result;
}

// vscode-oniguruma frees the pattern copy and the region but not the regex
// body, which belongs to the RegSet. The pattern is a std::string member here,
// so only the region and the struct need freeing.
void freeOnigRegExpBody(OnigRegExp* regexp) {
	onig_region_free(regexp->region, 1);
	delete regexp;
}

OnigRegion* searchOnigRegExp(
	OnigRegExp* regexp,
	const unsigned char* strData,
	int32_t strLength,
	int32_t position,
	OnigOptionType onigOption
) {
	const int32_t status = onig_search(
		regexp->regex,
		strData,
		strData + strLength,
		strData + position,
		strData + strLength,
		regexp->region,
		onigOption
	);
	if (status == ONIG_MISMATCH || status < 0) {
		regexp->lastSearchMatched = false;
		return nullptr;
	}
	regexp->lastSearchMatched = true;
	return regexp->region;
}

OnigRegion* searchOnigRegExpCached(
	OnigRegExp* regexp,
	int32_t strCacheId,
	const unsigned char* strData,
	int32_t strLength,
	int32_t position,
	OnigOptionType onigOption
) {
	if (regexp->hasGAnchor) {
		// \G anchors target the current search position; caching is unsafe.
		return searchOnigRegExp(regexp, strData, strLength, position, onigOption);
	}
	// Id 0 means "no identity" (the WASM engine's OnigString ids start at 1),
	// so the per-pattern cache must be bypassed to avoid false hits.
	if (strCacheId == 0) {
		return searchOnigRegExp(regexp, strData, strLength, position, onigOption);
	}
	if (
		regexp->lastSearchStrCacheId == strCacheId &&
		regexp->lastSearchOnigOption == onigOption &&
		regexp->lastSearchPosition <= position
	) {
		if (!regexp->lastSearchMatched) {
			return nullptr;
		}
		if (regexp->region->beg[0] >= position) {
			return regexp->region;
		}
	}
	regexp->lastSearchStrCacheId = strCacheId;
	regexp->lastSearchPosition = position;
	regexp->lastSearchOnigOption = onigOption;
	return searchOnigRegExp(regexp, strData, strLength, position, onigOption);
}

// Mirrors the WASM JS layer: unmatched groups are encoded as 0xFFFFFFFF when
// offsets are identity-mapped (pure ASCII), and clamped to the UTF-16 length
// otherwise. Both yield `length === 0` on the JS side.
int32_t encodeUtf16Offset(const OnigLine* line, int32_t utf8Offset) {
	if (utf8Offset == ONIG_REGION_NOTPOS) {
		return line->isAscii() ? 0xFFFFFFFF : line->utf16Length;
	}
	return line->utf8ToUtf16Offset(utf8Offset);
}

bool encodeOnigRegion(OnigScanner* scanner, const OnigLine* line, OnigRegion* region, int32_t index) {
	if (region == nullptr || region->num_regs > kMaxRegions) {
		return false;
	}
	const size_t needed = static_cast<size_t>(2 * (1 + region->num_regs));
	if (scanner->encoded.size() < needed) {
		scanner->encoded.resize(needed, 0);
	}
	scanner->encoded[0] = index;
	scanner->encoded[1] = region->num_regs;
	for (int32_t i = 0; i < region->num_regs; i++) {
		scanner->encoded[2 * i + 2] = encodeUtf16Offset(line, region->beg[i]);
		scanner->encoded[2 * i + 3] = encodeUtf16Offset(line, region->end[i]);
	}
	return true;
}

} // namespace

int32_t OnigLine::utf16ToUtf8Offset(int32_t position) const {
	if (position <= 0) return 0;
	if (position >= utf16Length) return static_cast<int32_t>(utf8.size());
	if (utf16ToUtf8.empty()) return position;
	return utf16ToUtf8[position];
}

int32_t OnigLine::utf8ToUtf16Offset(int32_t offset) const {
	if (offset <= 0) return 0;
	if (offset >= static_cast<int32_t>(utf8.size())) return utf16Length;
	if (utf8ToUtf16.empty()) return offset;
	return utf8ToUtf16[offset];
}

OnigScanner* createOnigScanner(const std::vector<std::string>& patterns, std::string& errorOut) {
	auto* scanner = new OnigScanner();
	const int32_t count = static_cast<int32_t>(patterns.size());
	if (count == 0) {
		errorOut = "empty pattern list";
		delete scanner;
		return nullptr;
	}
	std::vector<regex_t*> regs(static_cast<size_t>(count), nullptr);

	for (int32_t i = 0; i < count; i++) {
		OnigErrorInfo errorInfo = {};
		int status = ONIG_NORMAL;
		auto* regexp = createOnigRegExp(patterns[i], errorInfo, status);
		if (regexp == nullptr) {
			char message[ONIG_MAX_ERROR_MESSAGE_LEN];
			onig_error_code_to_str(reinterpret_cast<unsigned char*>(message), status, &errorInfo);
			errorOut = message;
			for (int32_t j = 0; j < i; j++) {
				onig_free(scanner->regexes[j]->regex);
				freeOnigRegExpBody(scanner->regexes[j]);
			}
			delete scanner;
			return nullptr;
		}
		regs[i] = regexp->regex;
		scanner->regexes.push_back(regexp);
	}

	onig_regset_new(&scanner->rset, count, regs.data());
	scanner->encoded.assign(4, 0);
	return scanner;
}

void freeOnigScanner(OnigScanner* scanner) {
	if (scanner == nullptr) return;
	for (auto* regexp : scanner->regexes) {
		freeOnigRegExpBody(regexp);
	}
	scanner->regexes.clear();
	onig_regset_free(scanner->rset);
	delete scanner;
}

OnigLine* createOnigLine(const std::string& utf8, int32_t utf16Length) {
	auto* line = new OnigLine();
	line->utf8 = utf8;
	line->utf16Length = utf16Length;
	const int32_t utf8Length = static_cast<int32_t>(utf8.size());
	if (utf8Length != utf16Length) {
		line->utf8ToUtf16.assign(static_cast<size_t>(utf8Length) + 1, 0);
		line->utf16ToUtf8.assign(static_cast<size_t>(utf16Length) + 1, 0);
		int32_t byteOffset = 0;
		int32_t codeUnitOffset = 0;
		const auto* data = reinterpret_cast<const unsigned char*>(utf8.data());
		while (byteOffset < utf8Length) {
			line->utf8ToUtf16[byteOffset] = codeUnitOffset;
			line->utf16ToUtf8[codeUnitOffset] = byteOffset;
			const unsigned char first = data[byteOffset];
			int32_t width = 1;
			if ((first & 0xE0) == 0xC0) {
				width = 2;
			} else if ((first & 0xF0) == 0xE0) {
				width = 3;
			} else if ((first & 0xF8) == 0xF0) {
				width = 4;
			}
			byteOffset += width;
			// 4-byte sequences encode supplementary code points (surrogate
			// pairs in UTF-16); everything else is one code unit.
			codeUnitOffset += width == 4 ? 2 : 1;
		}
		line->utf8ToUtf16[utf8Length] = utf16Length;
		line->utf16ToUtf8[utf16Length] = utf8Length;
	}
	return line;
}

void freeOnigLine(OnigLine* line) {
	delete line;
}

bool findNextMatch(
	OnigScanner* scanner,
	const OnigLine* line,
	int32_t utf16Position,
	int32_t options,
	int32_t strCacheId,
	const int32_t*& encodedOut,
	int32_t& lengthOut
) {
	const int32_t utf8Position = line->utf16ToUtf8Offset(utf16Position);
	const auto* strData = reinterpret_cast<const unsigned char*>(line->utf8.data());
	const int32_t strLength = static_cast<int32_t>(line->utf8.size());
	const OnigOptionType onigOption = toOnigOption(options);

	if (strLength < 1000) {
		// RegSet is faster for short strings.
		int bestLocation = 0;
	const int bestResultIndex = onig_regset_search(
			scanner->rset,
			strData,
			strData + strLength,
			strData + utf8Position,
			strData + strLength,
			ONIG_REGSET_POSITION_LEAD,
			onigOption,
			&bestLocation
		);
		if (bestResultIndex < 0) {
			return false;
		}
		OnigRegion* regsetRegion = onig_regset_get_region(scanner->rset, bestResultIndex);
		if (!encodeOnigRegion(
				scanner,
				line,
				regsetRegion,
				bestResultIndex
			)) {
			return false;
		}
		encodedOut = scanner->encoded.data();
		lengthOut = 2 + 2 * scanner->encoded[1];
		return true;
	}

	int32_t bestLocation = 0;
	int32_t bestResultIndex = 0;
	OnigRegion* bestResult = nullptr;
	for (int32_t i = 0; i < static_cast<int32_t>(scanner->regexes.size()); i++) {
		auto* regexp = scanner->regexes[i];
		OnigRegion* result =
			searchOnigRegExpCached(regexp, strCacheId, strData, strLength, utf8Position, onigOption);
		if (result != nullptr && result->num_regs > 0) {
			const int32_t location = result->beg[0];
			if (bestResult == nullptr || location < bestLocation) {
				bestLocation = location;
				bestResult = result;
				bestResultIndex = i;
			}
			if (location == utf8Position) {
				break;
			}
		}
	}
	if (bestResult == nullptr) {
		return false;
	}
	if (!encodeOnigRegion(scanner, line, bestResult, bestResultIndex)) {
		return false;
	}
	encodedOut = scanner->encoded.data();
	lengthOut = 2 + 2 * scanner->encoded[1];
	return true;
}

} // namespace nitro_onig
