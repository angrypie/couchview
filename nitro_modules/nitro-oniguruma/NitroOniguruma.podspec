require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroOniguruma"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "16.4" }
  s.source       = { :git => package["homepage"], :tag => "#{s.version}" }

  s.source_files = [
    # Nitro hybrid objects
    "cpp/**/*.{h,hpp,cpp}",
    # Hybrid object registration
    "ios/**/*.{h,m,mm}",
    # Vendored Oniguruma 6.9.8 (BSD-2-Clause)
    "vendor/oniguruma/**/*.{h,c}",
  ]
  # Data tables textually #included by unicode.c; compiling them standalone
  # fails (same split as the upstream automake build the WASM binary used).
  s.exclude_files = [
    "vendor/oniguruma/unicode_fold_data.c",
    "vendor/oniguruma/unicode_property_data.c",
    "vendor/oniguruma/unicode_egcb_data.c",
    "vendor/oniguruma/unicode_wb_data.c",
  ]
  s.public_header_files = [
    "cpp/**/*.{h,hpp}",
    "vendor/oniguruma/oniguruma.h",
  ]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "HEADER_SEARCH_PATHS" => [
      "$(PODS_TARGET_SRCROOT)/cpp",
      "$(PODS_TARGET_SRCROOT)/vendor/oniguruma",
    ],
  }

  s.dependency "NitroModules"
  install_modules_dependencies(s)
end
