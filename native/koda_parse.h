#ifndef KODA_PARSE_H
#define KODA_PARSE_H

#include <string>

#include "koda_value.h"

namespace koda {

// Parse KODA text to Value. Throws std::runtime_error on syntax error.
Value parse(const std::string& text, size_t max_depth = 256, size_t max_input_len = 1000000);

// Serialize Value to KODA text.
std::string stringify(const Value& value);

}  // namespace koda

#endif
