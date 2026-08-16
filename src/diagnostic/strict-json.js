// @ts-check

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DiagnosticContractError } from "./contract-error.js";

class StrictJsonParser {
  constructor(text, label) {
    this.text = text;
    this.label = label;
    this.index = 0;
  }

  parse() {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("contains trailing data");
    return value;
  }

  skipWhitespace() {
    while (/[\t\n\r ]/.test(this.text[this.index] ?? "")) this.index += 1;
  }

  fail(detail) {
    throw new DiagnosticContractError(`${this.label} ${detail} near byte ${this.index}.`);
  }

  parseValue() {
    this.skipWhitespace();
    const character = this.text[this.index];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    if (character === "-" || /[0-9]/.test(character ?? "")) return this.parseNumber();
    return this.fail("contains an unexpected token");
  }

  parseObject() {
    this.index += 1;
    const value = {};
    const keys = new Set();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail("contains a non-string object key");
      const key = this.parseString();
      if (keys.has(key)) throw new DiagnosticContractError(`${this.label} contains a duplicate JSON key: ${key}.`);
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("is missing an object colon");
      this.index += 1;
      value[key] = this.parseValue();
      this.skipWhitespace();
      const separator = this.text[this.index];
      if (separator === "}") {
        this.index += 1;
        return value;
      }
      if (separator !== ",") this.fail("is missing an object separator");
      this.index += 1;
    }
    return this.fail("contains an unterminated object");
  }

  parseArray() {
    this.index += 1;
    const value = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return value;
    }
    while (this.index < this.text.length) {
      value.push(this.parseValue());
      this.skipWhitespace();
      const separator = this.text[this.index];
      if (separator === "]") {
        this.index += 1;
        return value;
      }
      if (separator !== ",") this.fail("is missing an array separator");
      this.index += 1;
    }
    return this.fail("contains an unterminated array");
  }

  parseString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.text.slice(start, this.index));
        } catch {
          return this.fail("contains an invalid string");
        }
      }
      if (character === "\\") {
        this.index += 1;
        const escapeCharacter = this.text[this.index];
        if (escapeCharacter === "u") {
          const unicode = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(unicode)) this.fail("contains an invalid Unicode escape");
          this.index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escapeCharacter ?? "")) this.fail("contains an invalid escape");
      } else if (!character || character.charCodeAt(0) < 0x20) {
        this.fail("contains an invalid control character");
      }
      this.index += 1;
    }
    return this.fail("contains an unterminated string");
  }

  parseNumber() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.index));
    if (!match) this.fail("contains an invalid number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("contains a non-finite number");
    return value;
  }

  parseLiteral(token, value) {
    if (this.text.slice(this.index, this.index + token.length) !== token) this.fail("contains an invalid literal");
    this.index += token.length;
    return value;
  }
}

export function readBoundedJson(path, limit, label) {
  const absolutePath = resolve(path);
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    throw new DiagnosticContractError(`Unable to inspect ${label}.`);
  }
  if (!stat.isFile() || stat.size > limit) {
    throw new DiagnosticContractError(`${label} is not a bounded regular file.`);
  }
  let raw;
  try {
    raw = readFileSync(absolutePath);
  } catch {
    throw new DiagnosticContractError(`Unable to read ${label}.`);
  }
  if (raw.length > limit) throw new DiagnosticContractError(`${label} exceeds the maximum size.`);
  return { absolutePath, parsed: new StrictJsonParser(raw.toString("utf8"), label).parse() };
}
