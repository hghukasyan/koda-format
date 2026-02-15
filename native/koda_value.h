#ifndef KODA_VALUE_H
#define KODA_VALUE_H

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace koda {

struct Value;

using ValuePtr = std::shared_ptr<Value>;

struct Value {
  enum class Type { Null, Bool, Int, Float, String, Array, Object };

  Type type = Type::Null;
  bool b = false;
  int64_t i = 0;
  double d = 0.0;
  std::string s;
  std::vector<Value> arr;
  std::vector<std::pair<std::string, Value>> obj;  // key-order preserved; sorted at encode

  static Value null_val() {
    Value v;
    v.type = Type::Null;
    return v;
  }
  static Value bool_val(bool x) {
    Value v;
    v.type = Type::Bool;
    v.b = x;
    return v;
  }
  static Value int_val(int64_t x) {
    Value v;
    v.type = Type::Int;
    v.i = x;
    return v;
  }
  static Value float_val(double x) {
    Value v;
    v.type = Type::Float;
    v.d = x;
    return v;
  }
  static Value string_val(std::string x) {
    Value v;
    v.type = Type::String;
    v.s = std::move(x);
    return v;
  }
};

}  // namespace koda

#endif
