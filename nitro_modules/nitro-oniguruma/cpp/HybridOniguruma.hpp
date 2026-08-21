#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/HybridObject.hpp>

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "OnigCore.hpp"

namespace nitro_onig {

using namespace margelo::nitro;

/**
 * A JS string encoded for Oniguruma: UTF-8 bytes plus UTF-16 <-> UTF-8 offset
 * maps, built once per line and reused across all searches on that line.
 * Mirrors vscode-oniguruma's OnigString (which wraps a WASM-side UtfString).
 */
class HybridOnigString : public HybridObject {
public:
	explicit HybridOnigString(const std::string& text, double utf16Length);

public:
	std::shared_ptr<OnigLine> line;
	double utf16Length = 0;
	// Unique per string object (like the WASM engine's OnigString.id); keys
	// the per-pattern search cache on long lines.
	int32_t stringId = 0;

public:
	void dispose() override;
	size_t getExternalMemorySize() noexcept override;

private:
	static constexpr auto TAG = "OnigString";
};

/**
 * A compiled set of Oniguruma patterns, searched with the same leftmost-match
 * semantics as the shiki WASM engine. Created only by HybridOniguruma.
 */
class HybridOnigScanner : public HybridObject {
public:
	explicit HybridOnigScanner(const std::vector<std::string>& patterns);

public:
	std::optional<std::shared_ptr<ArrayBuffer>> findNextMatchSync(
		const std::shared_ptr<HybridOnigString>& text,
		double startPosition,
		double options
	);

public:
	void dispose() override;
	size_t getExternalMemorySize() noexcept override;

protected:
	void loadHybridMethods() override;

private:
	OnigScanner* _scanner;

private:
	static constexpr auto TAG = "OnigScanner";
};

/**
 * Factory for OnigScanner and OnigString hybrid objects. Registered in the
 * HybridObjectRegistry as "Oniguruma" and constructed from JS via
 * NitroModules.createHybridObject.
 */
class HybridOniguruma : public HybridObject {
public:
	HybridOniguruma() : HybridObject(TAG) {}

public:
	std::shared_ptr<HybridOnigScanner> createScanner(const std::vector<std::string>& patterns);
	std::shared_ptr<HybridOnigString> createString(const std::string& text, double utf16Length);

protected:
	void loadHybridMethods() override;

private:
	static constexpr auto TAG = "Oniguruma";
};

} // namespace nitro_onig
