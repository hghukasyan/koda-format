#include "koda_parse.h"

#include <cctype>
#include <stdexcept>
#include <utility>

namespace koda {

namespace {

class Lexer {
 public:
  explicit Lexer(const std::string& text) : data_(text), pos_(0), line_(1), col_(1) {}

  enum class Token {
    Eof,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    String,
    Identifier,
    Integer,
    Float,
    True,
    False,
    Null,
  };

  Token token() const { return token_; }
  const std::string& string_val() const { return string_val_; }
  int64_t int_val() const { return int_val_; }
  double float_val() const { return float_val_; }

  void advance() {
    skip_ws_and_comments();
    start_line_ = line_;
    start_col_ = col_;
    if (pos_ >= data_.size()) {
      token_ = Token::Eof;
      return;
    }
    char c = data_[pos_];
    if (c == '{') { pos_++; token_ = Token::LBrace; return; }
    if (c == '}') { pos_++; token_ = Token::RBrace; return; }
    if (c == '[') { pos_++; token_ = Token::LBracket; return; }
    if (c == ']') { pos_++; token_ = Token::RBracket; return; }
    if (c == ':') { pos_++; token_ = Token::Colon; return; }
    if (c == ',') { pos_++; token_ = Token::Comma; return; }
    if (c == '"' || c == '\'') { read_quoted(c); return; }
    if (c == '-' || (c >= '0' && c <= '9')) { read_number(); return; }
    if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') { read_identifier(); return; }
    error("Unexpected character");
  }

  void error(const std::string& msg) const {
    throw std::runtime_error(msg + " at line " + std::to_string(start_line_) +
                             " column " + std::to_string(start_col_));
  }

 private:
  void skip_ws_and_comments() {
    while (pos_ < data_.size()) {
      char c = data_[pos_];
      if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
        if (c == '\n') { line_++; col_ = 1; } else { col_++; }
        pos_++;
        continue;
      }
      if (c == '/' && pos_ + 1 < data_.size() && data_[pos_ + 1] == '/') {
        pos_ += 2;
        while (pos_ < data_.size() && data_[pos_] != '\n') pos_++;
        continue;
      }
      if (c == '/' && pos_ + 1 < data_.size() && data_[pos_ + 1] == '*') {
        pos_ += 2;
        size_t depth = 1;
        while (depth > 0 && pos_ + 1 < data_.size()) {
          if (data_[pos_] == '*' && data_[pos_ + 1] == '/') { pos_ += 2; depth--; }
          else if (data_[pos_] == '/' && data_[pos_ + 1] == '*') { pos_ += 2; depth++; }
          else { if (data_[pos_] == '\n') { line_++; col_ = 1; } else col_++; pos_++; }
        }
        if (depth != 0) error("Unclosed comment");
        continue;
      }
      return;
    }
  }

  void read_quoted(char quote) {
    pos_++;
    string_val_.clear();
    bool closed = false;
    while (pos_ < data_.size()) {
      char c = data_[pos_++];
      col_++;
      if (c == quote) { closed = true; break; }
      if (c == '\\') {
        if (pos_ >= data_.size()) error("Unclosed string");
        c = data_[pos_++];
        col_++;
        if (c == quote) string_val_ += quote;
        else if (c == '\\') string_val_ += '\\';
        else if (c == 'n') string_val_ += '\n';
        else if (c == 'r') string_val_ += '\r';
        else if (c == 't') string_val_ += '\t';
        else string_val_ += c;
      } else if (static_cast<unsigned char>(c) < 0x20) {
        error("Control character in string");
      } else {
        string_val_ += c;
      }
    }
    if (!closed) error("Unclosed string");
    token_ = Token::String;
  }

  void read_number() {
    size_t start = pos_;
    if (data_[pos_] == '-') pos_++, col_++;
    if (data_[pos_] == '0' && pos_ + 1 < data_.size()) {
      char n = data_[pos_ + 1];
      if (n >= '0' && n <= '9') error("Leading zero");
    }
    bool is_float = false;
    while (pos_ < data_.size() && std::isdigit(static_cast<unsigned char>(data_[pos_])))
      pos_++, col_++;
    if (pos_ < data_.size() && data_[pos_] == '.') {
      is_float = true;
      pos_++, col_++;
      while (pos_ < data_.size() && std::isdigit(static_cast<unsigned char>(data_[pos_])))
        pos_++, col_++;
    }
    if (pos_ < data_.size() && (data_[pos_] == 'e' || data_[pos_] == 'E')) {
      is_float = true;
      pos_++, col_++;
      if (pos_ < data_.size() && (data_[pos_] == '+' || data_[pos_] == '-')) pos_++, col_++;
      while (pos_ < data_.size() && std::isdigit(static_cast<unsigned char>(data_[pos_])))
        pos_++, col_++;
    }
    std::string num_str(data_.substr(start, pos_ - start));
    if (is_float) {
      try {
        float_val_ = std::stod(num_str);
      } catch (...) {
        error("Invalid float");
      }
      token_ = Token::Float;
    } else {
      try {
        int_val_ = std::stoll(num_str);
      } catch (...) {
        error("Invalid integer");
      }
      token_ = Token::Integer;
    }
  }

  void read_identifier() {
    size_t start = pos_;
    while (pos_ < data_.size()) {
      char c = data_[pos_];
      if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_' && c != '-') break;
      pos_++;
      col_++;
    }
    string_val_ = data_.substr(start, pos_ - start);
    if (string_val_ == "true") token_ = Token::True;
    else if (string_val_ == "false") token_ = Token::False;
    else if (string_val_ == "null") token_ = Token::Null;
    else token_ = Token::Identifier;
  }

  const std::string& data_;
  size_t pos_;
  int line_, col_;
  int start_line_, start_col_;
  Token token_ = Token::Eof;
  std::string string_val_;
  int64_t int_val_ = 0;
  double float_val_ = 0;
};

class Parser {
 public:
  Parser(const std::string& text, size_t max_depth)
      : lex_(text), max_depth_(max_depth) {
    lex_.advance();
  }

  void expect_eof() {
    if (lex_.token() != Lexer::Token::Eof) lex_.error("Expected end of input");
  }

  Value parse_document() {
    if (lex_.token() == Lexer::Token::Identifier || lex_.token() == Lexer::Token::String) {
      Lexer copy = lex_;
      copy.advance();
      if (copy.token() != Lexer::Token::Eof)
        return parse_root_object(0);
    }
    return parse_value(0);
  }

  Value parse_root_object(size_t depth) {
    Value v;
    v.type = Value::Type::Object;
    while (lex_.token() == Lexer::Token::Identifier || lex_.token() == Lexer::Token::String) {
      std::string key = lex_.string_val();
      lex_.advance();
      if (lex_.token() == Lexer::Token::Colon) lex_.advance();
      for (const auto& p : v.obj)
        if (p.first == key) lex_.error("Duplicate key");
      v.obj.emplace_back(key, parse_value(depth + 1));
    }
    return v;
  }

  Value parse_value(size_t depth) {
    if (depth > max_depth_) throw std::runtime_error("Maximum nesting depth exceeded");
    switch (lex_.token()) {
      case Lexer::Token::LBrace:
        return parse_object(depth);
      case Lexer::Token::LBracket:
        return parse_array(depth);
      case Lexer::Token::String:
        return parse_string_val();
      case Lexer::Token::Identifier: {
        Value v = Value::string_val(lex_.string_val());
        lex_.advance();
        return v;
      }
      case Lexer::Token::Integer:
        return parse_int_val();
      case Lexer::Token::Float:
        return parse_float_val();
      case Lexer::Token::True:
        return parse_true();
      case Lexer::Token::False:
        return parse_false();
      case Lexer::Token::Null:
        return parse_null();
      default:
        lex_.error("Unexpected token");
    }
    return Value::null_val();
  }

 private:
  Value parse_string_val() {
    Value v = Value::string_val(lex_.string_val());
    lex_.advance();
    return v;
  }
  Value parse_int_val() {
    Value v = Value::int_val(lex_.int_val());
    lex_.advance();
    return v;
  }
  Value parse_float_val() {
    Value v = Value::float_val(lex_.float_val());
    lex_.advance();
    return v;
  }
  Value parse_true() {
    lex_.advance();
    return Value::bool_val(true);
  }
  Value parse_false() {
    lex_.advance();
    return Value::bool_val(false);
  }
  Value parse_null() {
    lex_.advance();
    return Value::null_val();
  }

  Value parse_object(size_t depth) {
    lex_.advance();  // consume {
    Value v;
    v.type = Value::Type::Object;
    while (lex_.token() != Lexer::Token::RBrace) {
      std::string key;
      if (lex_.token() == Lexer::Token::Identifier)
        key = lex_.string_val();
      else if (lex_.token() == Lexer::Token::String)
        key = lex_.string_val();
      else
        lex_.error("Expected key");
      lex_.advance();
      if (lex_.token() == Lexer::Token::Colon) lex_.advance();
      for (const auto& p : v.obj)
        if (p.first == key) lex_.error("Duplicate key");
      v.obj.emplace_back(key, parse_value(depth + 1));
      if (lex_.token() == Lexer::Token::Comma) lex_.advance();
    }
    lex_.advance();  // consume }
    return v;
  }

  Value parse_array(size_t depth) {
    lex_.advance();  // consume [
    Value v;
    v.type = Value::Type::Array;
    while (lex_.token() != Lexer::Token::RBracket) {
      v.arr.push_back(parse_value(depth + 1));
      if (lex_.token() == Lexer::Token::Comma) lex_.advance();
    }
    lex_.advance();  // consume ]
    return v;
  }

  Lexer lex_;
  size_t max_depth_;
};

void stringify_value(const Value& v, std::string& out, bool quote_strings) {
  switch (v.type) {
    case Value::Type::Null:
      out += "null";
      break;
    case Value::Type::Bool:
      out += v.b ? "true" : "false";
      break;
    case Value::Type::Int:
      out += std::to_string(v.i);
      break;
    case Value::Type::Float:
      out += std::to_string(v.d);
      break;
    case Value::Type::String:
      if (quote_strings) {
        out += '"';
        for (char c : v.s) {
          if (c == '"' || c == '\\') out += '\\';
          out += c;
        }
        out += '"';
      } else {
        out += v.s;
      }
      break;
    case Value::Type::Array:
      out += '[';
      for (size_t i = 0; i < v.arr.size(); ++i) {
        if (i) out += ' ';
        stringify_value(v.arr[i], out, true);
      }
      out += ']';
      break;
    case Value::Type::Object:
      out += '{';
      for (size_t i = 0; i < v.obj.size(); ++i) {
        if (i) out += ' ';
        const auto& p = v.obj[i];
        out += p.first;
        out += ':';
        stringify_value(p.second, out, true);
      }
      out += '}';
      break;
  }
}

}  // namespace

Value parse(const std::string& text, size_t max_depth, size_t max_input_len) {
  if (text.size() > max_input_len)
    throw std::runtime_error("Input exceeds maximum length");
  Parser p(text, max_depth);
  Value v = p.parse_document();
  p.expect_eof();
  return v;
}

std::string stringify(const Value& value) {
  std::string out;
  stringify_value(value, out, true);
  return out;
}

}  // namespace koda
