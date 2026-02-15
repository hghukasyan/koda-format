#ifndef KODA_BINARY_H
#define KODA_BINARY_H

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "koda_value.h"

namespace koda {

// Binary format constants (SPEC §6)
constexpr uint8_t MAGIC[] = {0x4B, 0x4F, 0x44, 0x41};
constexpr uint8_t VERSION = 1;

constexpr uint8_t TAG_NULL = 0x01;
constexpr uint8_t TAG_FALSE = 0x02;
constexpr uint8_t TAG_TRUE = 0x03;
constexpr uint8_t TAG_INTEGER = 0x04;
constexpr uint8_t TAG_FLOAT = 0x05;
constexpr uint8_t TAG_STRING = 0x06;
constexpr uint8_t TAG_BINARY = 0x07;
constexpr uint8_t TAG_ARRAY = 0x10;
constexpr uint8_t TAG_OBJECT = 0x11;

// Encode value to canonical binary. Throws std::runtime_error on depth exceed.
std::vector<uint8_t> encode(const Value& value, size_t max_depth = 256);

// Decode binary to value. Throws std::runtime_error on invalid input.
Value decode(const uint8_t* data, size_t size, size_t max_depth = 256,
             size_t max_dict = 65536, size_t max_str_len = 1000000);

}  // namespace koda

#endif
