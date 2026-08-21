/*
 * Oniguruma 6.9.8 config for Apple platforms (iOS/tvOS/macOS) and macOS host
 * builds. Mirrors the CMake configure defaults used by the emscripten build
 * that produced the shiki WASM binary (USE_CRNL_AS_LINE_TERMINATOR stays
 * undefined) so regex behavior matches byte-for-byte.
 */
#ifndef ONIG_CONFIG_H
#define ONIG_CONFIG_H

#define HAVE_ALLOCA 1
#define HAVE_ALLOCA_H 1
#define HAVE_STDINT_H 1
#define HAVE_SYS_TIMES_H 1
#define HAVE_SYS_TIME_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1
#define HAVE_INTTYPES_H 1

#define SIZEOF_INT 4
#define SIZEOF_LONG 8
#define SIZEOF_LONG_LONG 8
#define SIZEOF_VOIDP 8

#define PACKAGE "onig"
#define PACKAGE_VERSION "6.9.8"
#define VERSION "6.9.8"

#endif /* ONIG_CONFIG_H */
