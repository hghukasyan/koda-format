#include "koda_binary.h"

#include <algorithm>
#include <stdexcept>
#include <set>

namespace koda {

namespace {

void collect_keys(const Value& v, std::set<std::string>& out) {
  switch (v.type) {
    case Value::Type::Null:
    case Value::Type::Bool:
    case Value::Type::Int:
    case Value::Type::Float:
    case Value::Type::String:
      break;
    case Value::Type::Array:
      for (const auto& el : v.arr) collect_keys(el, out);
      break;
    case Value::Type::Object:
      for (const auto& p : v.obj) {
        out.insert(p.first);
        collect_keys(p.second, out);
      }
      break;
  }
}

struct Encoder {
  std::vector<uint8_t> buf;
  size_t max_depth;
  std::vector<std::string> dictionary;
  std::map<std::string, size_t> key_to_index;

  void u8(uint8_t x) { buf.push_back(x); }
  void u32_be(uint32_t x) {
    buf.push_back((x >> 24) & 0xFF);
    buf.push_back((x >> 16) & 0xFF);
    buf.push_back((x >> 8) & 0xFF);
    buf.push_back(x & 0xFF);
  }
  void i64_be(int64_t x) {
    for (int i = 7; i >= 0; --i) buf.push_back((x >> (i * 8)) & 0xFF);
  }
  void f64_be(double x) {
    uint64_t u;
    memcpy(&u, &x, 8);
    for (int i = 7; i >= 0; --i) buf.push_back((u >> (i * 8)) & 0xFF);
  }
  void bytes(const uint8_t* p, size_t n) {
    for (size_t i = 0; i < n; ++i) buf.push_back(p[i]);
  }

  void encode_value(const Value& v, size_t depth) {
    if (depth > max_depth) throw std::runtime_error("Maximum nesting depth exceeded");
    switch (v.type) {
      case Value::Type::Null:
        u8(TAG_NULL);
        break;
      case Value::Type::Bool:
        u8(v.b ? TAG_TRUE : TAG_FALSE);
        break;
      case Value::Type::Int:
        u8(TAG_INTEGER);
        i64_be(v.i);
        break;
      case Value::Type::Float:
        u8(TAG_FLOAT);
        f64_be(v.d);
        break;
      case Value::Type::String:
        u8(TAG_STRING);
        u32_be(static_cast<uint32_t>(v.s.size()));
        bytes(reinterpret_cast<const uint8_t*>(v.s.data()), v.s.size());
        break;
      case Value::Type::Array:
        u8(TAG_ARRAY);
        u32_be(static_cast<uint32_t>(v.arr.size()));
        for (const auto& el : v.arr) encode_value(el, depth + 1);
        break;
      case Value::Type::Object: {
        u8(TAG_OBJECT);
        std::vector<std::pair<std::string, Value>> sorted = v.obj;
        std::sort(sorted.begin(), sorted.end(),
                  [](const auto& a, const auto& b) { return a.first < b.first; });
        u32_be(static_cast<uint32_t>(sorted.size()));
        for (const auto& p : sorted) {
          auto it = key_to_index.find(p.first);
          if (it == key_to_index.end()) throw std::runtime_error("Key not in dictionary");
          u32_be(static_cast<uint32_t>(it->second));
          encode_value(p.second, depth + 1);
        }
        break;
      }
    }
  }
};

}  // namespace

std::vector<uint8_t> encode(const Value& value, size_t max_depth) {
  std::set<std::string> keys_set;
  collect_keys(value, keys_set);
  std::vector<std::string> dictionary(keys_set.begin(), keys_set.end());
  std::map<std::string, size_t> key_to_index;
  for (size_t i = 0; i < dictionary.size(); ++i) key_to_index[dictionary[i]] = i;

  Encoder enc;
  enc.max_depth = max_depth;
  enc.dictionary = std::move(dictionary);
  enc.key_to_index = std::move(key_to_index);

  enc.bytes(MAGIC, 4);
  enc.u8(VERSION);
  enc.u32_be(static_cast<uint32_t>(enc.dictionary.size()));
  for (const auto& k : enc.dictionary) {
    enc.u32_be(static_cast<uint32_t>(k.size()));
    enc.bytes(reinterpret_cast<const uint8_t*>(k.data()), k.size());
  }
  enc.encode_value(value, 0);
  return enc.buf;
}

namespace {

struct Decoder {
  const uint8_t* data;
  size_t size;
  size_t offset = 0;
  size_t max_depth;
  size_t max_dict;
  size_t max_str;
  std::vector<std::string> dictionary;

  void ensure(size_t n) {
    if (offset + n > size) throw std::runtime_error("Truncated input");
  }
  uint8_t u8() {
    ensure(1);
    return data[offset++];
  }
  uint32_t u32_be() {
    ensure(4);
    uint32_t x = (static_cast<uint32_t>(data[offset]) << 24) |
                 (static_cast<uint32_t>(data[offset + 1]) << 16) |
                 (static_cast<uint32_t>(data[offset + 2]) << 8) |
                 data[offset + 3];
    offset += 4;
    return x;
  }
  int64_t i64_be() {
    ensure(8);
    uint64_t u = 0;
    for (int i = 0; i < 8; ++i) u = (u << 8) | data[offset + i];
    offset += 8;
    int64_t x;
    memcpy(&x, &u, 8);
    return x;
  }
  double f64_be() {
    ensure(8);
    uint64_t u = 0;
    for (int i = 0; i < 8; ++i) u = (u << 8) | data[offset + i];
    offset += 8;
    double x;
    memcpy(&x, &u, 8);
    return x;
  }

  Value decode_value(size_t depth) {
    if (depth > max_depth) throw std::runtime_error("Maximum nesting depth exceeded");
    ensure(1);
    uint8_t tag = u8();
    switch (tag) {
      case TAG_NULL:
        return Value::null_val();
      case TAG_FALSE:
        return Value::bool_val(false);
      case TAG_TRUE:
        return Value::bool_val(true);
      case TAG_INTEGER:
        return Value::int_val(i64_be());
      case TAG_FLOAT:
        return Value::float_val(f64_be());
      case TAG_STRING: {
        uint32_t len = u32_be();
        if (len > max_str) throw std::runtime_error("String too long");
        ensure(len);
        std::string s(reinterpret_cast<const char*>(data + offset), len);
        offset += len;
        return Value::string_val(std::move(s));
      }
      case TAG_BINARY:
        throw std::runtime_error("Binary type not supported");
      case TAG_ARRAY: {
        Value v;
        v.type = Value::Type::Array;
        uint32_t n = u32_be();
        v.arr.reserve(n);
        for (uint32_t i = 0; i < n; ++i) v.arr.push_back(decode_value(depth + 1));
        return v;
      }
      case TAG_OBJECT: {
        Value v;
        v.type = Value::Type::Object;
        uint32_t n = u32_be();
        for (uint32_t i = 0; i < n; ++i) {
          uint32_t idx = u32_be();
          if (idx >= dictionary.size()) throw std::runtime_error("Invalid key index");
          v.obj.emplace_back(dictionary[idx], decode_value(depth + 1));
        }
        return v;
      }
      default:
        throw std::runtime_error("Unknown type tag");
    }
  }
};

}  // namespace

Value decode(const uint8_t* data, size_t size, size_t max_depth, size_t max_dict,
             size_t max_str_len) {
  Decoder dec;
  dec.data = data;
  dec.size = size;
  dec.max_depth = max_depth;
  dec.max_dict = max_dict;
  dec.max_str = max_str_len;

  dec.ensure(5);
  for (int i = 0; i < 4; ++i)
    if (dec.data[i] != MAGIC[i]) throw std::runtime_error("Invalid magic number");
  dec.offset = 4;
  uint8_t version = dec.u8();
  if (version != VERSION) throw std::runtime_error("Unsupported version");

  uint32_t dict_len = dec.u32_be();
  if (dict_len > max_dict) throw std::runtime_error("Dictionary too large");
  dec.dictionary.reserve(dict_len);
  for (uint32_t i = 0; i < dict_len; ++i) {
    uint32_t key_len = dec.u32_be();
    if (key_len > max_str_len) throw std::runtime_error("Key string too long");
    dec.ensure(key_len);
    dec.dictionary.emplace_back(reinterpret_cast<const char*>(dec.data + dec.offset), key_len);
    dec.offset += key_len;
  }

  Value v = dec.decode_value(0);
  if (dec.offset != size) throw std::runtime_error("Trailing bytes after root value");
  return v;
}

}  // namespace koda
