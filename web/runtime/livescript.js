var LiveScript = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // ../../shim-buffer.js
  var Buffer2;
  var init_shim_buffer = __esm({
    "../../shim-buffer.js"() {
      Buffer2 = {
        from: (value) => value,
        isBuffer: () => false,
        alloc: () => ""
      };
    }
  });

  // lib/lexer.js
  var require_lexer = __commonJS({
    "lib/lexer.js"(exports) {
      init_shim_buffer();
      var string;
      var TABS;
      var unlines;
      var enlines;
      var enslash;
      var reslash;
      var camelize;
      var deheregex;
      var character;
      var KEYWORDS_SHARED;
      var KEYWORDS_UNUSED;
      var JS_KEYWORDS;
      var LS_KEYWORDS;
      var ID;
      var SYMBOL;
      var SPACE;
      var MULTIDENT;
      var SIMPLESTR;
      var JSTOKEN;
      var BSTOKEN;
      var NUMBER;
      var NUMBER_OMIT;
      var REGEX;
      var HEREGEX_OMIT;
      var LASTDENT;
      var INLINEDENT;
      var NONASCII;
      var OPENERS;
      var CLOSERS;
      var INVERSES;
      var i;
      var o;
      var c;
      var CHAIN;
      var ARG;
      var BLOCK_USERS;
      var slice$ = [].slice;
      var arrayFrom$ = Array.from || function(x) {
        return slice$.call(x);
      };
      exports.lex = function(code, options) {
        return clone$(exports).tokenize(code || "", options || {});
      };
      exports.rewrite = function(it) {
        var ref$;
        it || (it = this.tokens);
        firstPass(it);
        addImplicitIndentation(it);
        rewriteBlockless(it);
        addImplicitParentheses(it);
        addImplicitBraces(it);
        expandLiterals(it);
        if (((ref$ = it[0]) != null ? ref$[0] : void 0) === "NEWLINE") {
          it.shift();
        }
        return it;
      };
      exports.tokenize = function(code, o2) {
        var i2, prevIndex, c2, charsConsumed, that;
        this.inter || (code = code.replace(/[\r\u2028\u2029\uFEFF]/g, ""));
        code = "\n" + code;
        this.tokens = [this.last = ["NEWLINE", "\n", 0, 0]];
        this.line = ~-o2.line;
        this.column = o2.column || 0;
        this.dents = [];
        this.closes = [];
        this.parens = [];
        this.flags = [];
        i2 = 0;
        prevIndex = i2;
        this.charsCounted = 0;
        this.isAtPrefix = true;
        while (c2 = code.charAt(i2)) {
          charsConsumed = i2 - prevIndex;
          prevIndex = i2;
          if (this.charsCounted > charsConsumed) {
            throw new Error("Location information out-of-sync in lexer");
          }
          this.column += charsConsumed - this.charsCounted;
          this.charsCounted = 0;
          switch (c2) {
            case " ":
              i2 += this.doSpace(code, i2);
              break;
            case "\n":
              i2 += this.doLine(code, i2);
              break;
            case "\\":
              i2 += this.doBackslash(code, i2);
              break;
            case "'":
            case '"':
              i2 += this.doString(code, i2, c2);
              break;
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            case "8":
            case "9":
              i2 += this.doNumber(code, i2);
              break;
            case "/":
              switch (code.charAt(i2 + 1)) {
                case "*":
                  i2 += this.doComment(code, i2);
                  break;
                case "/":
                  i2 += this.doHeregex(code, i2);
                  break;
                default:
                  i2 += this.doRegex(code, i2) || this.doLiteral(code, i2);
              }
              break;
            case "`":
              if ("`" === code.charAt(i2 + 1)) {
                i2 += this.doJS(code, i2);
              } else {
                i2 += this.doLiteral(code, i2);
              }
              break;
            default:
              i2 += this.doID(code, i2) || this.doLiteral(code, i2) || this.doSpace(code, i2);
          }
        }
        this.dedent(this.dent);
        if (that = this.closes.pop()) {
          this.carp("missing `" + that + "`");
        }
        if (this.inter) {
          this.rest == null && this.carp("unterminated interpolation");
        } else {
          this.last.spaced = true;
          this.newline();
        }
        o2.raw || this.rewrite();
        return this.tokens;
      };
      exports.dent = 0;
      exports.identifiers = {};
      exports.reset = function() {
        this.dent = 0;
        this.identifiers = {};
      };
      exports.hasOwn = Object.prototype.hasOwnProperty;
      exports.checkConsistency = function(camel, id) {
        if (this.hasOwn.call(this.identifiers, camel) && this.identifiers[camel] !== id) {
          throw new ReferenceError("Inconsistent use of " + camel + " as " + id + " on line " + -~this.line);
        } else {
          return this.identifiers[camel] = id;
        }
      };
      exports.doID = function(code, index) {
        var regexMatch, input, id, e, last, ref$, tag, ref1$, that;
        input = (regexMatch = (ID.lastIndex = index, ID).exec(code))[0];
        if (!input) {
          return 0;
        }
        id = camelize(regexMatch[1]);
        if (/-/.test(regexMatch[1])) {
          this.checkConsistency(id, regexMatch[1]);
        }
        if (NONASCII.test(id)) {
          try {
            Function("var " + id);
          } catch (e$) {
            e = e$;
            this.carp("invalid identifier '" + id + "'");
          }
        }
        last = this.last;
        if (regexMatch[2] || last[0] === "DOT" || this.adi()) {
          this.token("ID", in$(id, JS_KEYWORDS) ? (ref$ = Object(id), ref$.reserved = true, ref$) : id);
          if (regexMatch[2]) {
            this.token(":", ":");
          }
          return input.length;
        }
        switch (id) {
          case "true":
          case "false":
          case "on":
          case "off":
          case "yes":
          case "no":
          case "null":
          case "void":
          case "arguments":
          case "debugger":
            tag = "LITERAL";
            break;
          case "new":
          case "do":
          case "typeof":
          case "delete":
            tag = "UNARY";
            break;
          case "yield":
          case "await":
            tag = "YIELD";
            break;
          case "return":
          case "throw":
            tag = "HURL";
            break;
          case "break":
          case "continue":
            tag = "JUMP";
            break;
          case "this":
          case "eval":
          case "super":
            return this.token("LITERAL", id, true).length;
          case "for":
            id = [];
            this.fset("for", true);
            this.fset("to", false);
            this.fset("by", true);
            break;
          case "then":
            this.fset("for", false);
            this.fset("to", false);
            break;
          case "catch":
          case "function":
            id = "";
            break;
          case "in":
          case "of":
            if (this.fget("for")) {
              this.fset("for", false);
              if (id === "in") {
                this.fset("by", true);
                id = "";
                if (last[0] === "ID" && ((ref$ = (ref1$ = this.tokens)[ref1$.length - 2][0]) === "," || ref$ === "]" || ref$ === "}")) {
                  id = this.tokens.pop()[1];
                  if ((ref$ = this.tokens)[ref$.length - 1][0] === ",") {
                    this.tokens.pop();
                  }
                }
              }
              break;
            }
          // fallthrough
          case "instanceof":
            if (last[1] === "!") {
              id = this.tokens.pop()[1] + id;
            }
            tag = (ref$ = this.tokens)[ref$.length - 1][0] === "(" ? "BIOPR" : "RELATION";
            break;
          case "not":
            if (last.alias && last[1] === "===") {
              return last[1] = "!==", 3;
            }
            tag = "UNARY";
            id = "!";
            break;
          case "and":
          case "or":
          case "xor":
          case "is":
          case "isnt":
            this.unline();
            tag = id === "is" || id === "isnt" ? "COMPARE" : "LOGIC";
            if (last[0] === "(") {
              tag = "BIOP";
            }
            this.token(tag, (function() {
              switch (id) {
                case "is":
                  return "===";
                case "isnt":
                  return "!==";
                case "or":
                  return "||";
                case "and":
                  return "&&";
                case "xor":
                  return "xor";
              }
            })());
            this.last.alias = true;
            return id.length;
          case "unless":
            tag = "IF";
            break;
          case "until":
            tag = "WHILE";
            break;
          case "import":
            if (last[0] === "(") {
              id = "<<<";
              tag = "BIOP";
            } else {
              if (able(this.tokens)) {
                id = "<<<";
              } else {
                tag = "DECL";
              }
            }
            break;
          case "export":
          case "const":
          case "var":
            tag = "DECL";
            break;
          case "with":
            tag = function() {
              switch (false) {
                case !able(this.tokens):
                  return "CLONEPORT";
                case last[0] !== "(":
                  return "BIOP";
                default:
                  return "WITH";
              }
            }.call(this);
            break;
          case "when":
            tag = "CASE";
          // fallthrough
          case "case":
            if (this.doCase()) {
              return input.length;
            }
            break;
          case "match":
            tag = "SWITCH";
            break;
          case "loop":
            this.token("WHILE", id);
            this.token("LITERAL", "true");
            return input.length;
          case "let":
          case "own":
            if (last[0] === "FOR" && !in$(id, last[1])) {
              last[1].push(id);
              return 3;
            }
          // fallthrough
          default:
            if (in$(id, KEYWORDS_SHARED)) {
              break;
            }
            if (in$(id, KEYWORDS_UNUSED)) {
              this.carp("reserved word '" + id + "'");
            }
            if (!last[1] && ((ref$ = last[0]) === "FUNCTION" || ref$ === "GENERATOR" || ref$ === "LABEL")) {
              last[1] = id;
              last.spaced = false;
              return input.length;
            }
            tag = "ID";
            switch (id) {
              case "otherwise":
                if ((ref$ = last[0]) === "CASE" || ref$ === "|") {
                  last[0] = "DEFAULT";
                  return id.length;
                }
                break;
              case "all":
                if (that = last[1] === "<<<" && "<" || last[1] === "import" && "All") {
                  last[1] += that;
                  return 3;
                }
                break;
              case "from":
                if (last[1] === "yield") {
                  last[1] += "from";
                  return 4;
                }
                this.forange() && (tag = "FROM");
                break;
              case "to":
              case "til":
                this.forange() && this.tokens.push(["FROM", "", this.line, this.column], ["STRNUM", "0", this.line, this.column]);
                if (this.fget("from")) {
                  this.fset("from", false);
                  this.fset("by", true);
                  tag = "TO";
                } else if (!last.callable && last[0] === "STRNUM" && (ref$ = this.tokens)[ref$.length - 2][0] === "[") {
                  last[0] = "RANGE";
                  last.op = id;
                  return id.length;
                } else if (in$("]", this.closes)) {
                  this.token("TO", id);
                  return id.length;
                }
                break;
              case "by":
                if (last[0] === "STRNUM" && (ref$ = this.tokens)[ref$.length - 2][0] === "RANGE" && (ref$ = this.tokens)[ref$.length - 3][0] === "[") {
                  tag = "RANGE_BY";
                } else if (in$("]", this.closes)) {
                  tag = "BY";
                } else if (this.fget("by") && last[0] !== "FOR") {
                  tag = "BY";
                  this.fset("by", false);
                }
                break;
              case "ever":
                if (last[0] === "FOR") {
                  this.fset("for", false);
                  last[0] = "WHILE";
                  tag = "LITERAL";
                  id = "true";
                }
            }
        }
        tag || (tag = regexMatch[1].toUpperCase());
        if ((tag === "COMPARE" || tag === "LOGIC" || tag === "RELATION") && last[0] === "(") {
          tag = tag === "RELATION" ? "BIOPR" : "BIOP";
        }
        if (tag === "THEN" || tag === "IF" || tag === "WHILE") {
          this.fset("for", false);
          this.fset("by", false);
        }
        if (tag === "RELATION" || tag === "THEN" || tag === "ELSE" || tag === "CASE" || tag === "DEFAULT" || tag === "CATCH" || tag === "FINALLY" || tag === "IN" || tag === "OF" || tag === "FROM" || tag === "TO" || tag === "BY" || tag === "EXTENDS" || tag === "IMPLEMENTS" || tag === "WHERE") {
          this.unline();
        }
        this.token(tag, id);
        return input.length;
      };
      exports.doNumber = function(code, lastIndex) {
        var input, regexMatch, last, radix, num, rnum, bound, ref$;
        NUMBER.lastIndex = lastIndex;
        if (!(input = (regexMatch = NUMBER.exec(code))[0])) {
          return 0;
        }
        last = this.last;
        if (regexMatch[5] && (last[0] === "DOT" || this.adi())) {
          this.token("STRNUM", regexMatch[4].replace(NUMBER_OMIT, ""));
          return regexMatch[4].length;
        }
        if (radix = regexMatch[1]) {
          num = parseInt(rnum = regexMatch[2].replace(NUMBER_OMIT, ""), radix);
          bound = false;
          if (radix > 36 || radix < 2) {
            if (/[0-9]/.exec(rnum)) {
              this.carp("invalid number base " + radix + " (with number " + rnum + "),base must be from 2 to 36");
            } else {
              bound = true;
            }
          }
          if (isNaN(num) || num === parseInt(rnum.slice(0, -1), radix)) {
            this.strnum(regexMatch[1]);
            this.token("DOT", ".~");
            this.token("ID", regexMatch[2]);
            return input.length;
          }
          num += "";
        } else {
          num = (regexMatch[3] || input).replace(NUMBER_OMIT, "");
          if (regexMatch[3] && num.charAt() === "0" && ((ref$ = num.charAt(1)) !== "" && ref$ !== ".")) {
            this.carp("deprecated octal literal " + regexMatch[4]);
          }
        }
        if (!last.spaced && last[0] === "+-") {
          last[0] = "STRNUM";
          last[1] += num;
          return input.length;
        }
        this.strnum(num);
        return input.length;
      };
      exports.doString = function(code, index, q) {
        var parts, str;
        if (q === code.charAt(index + 1)) {
          return q === code.charAt(index + 2) ? this.doHeredoc(code, index, q) : (this.strnum(q + q), 2);
        }
        if (q === '"') {
          parts = this.interpolate(code, index, q);
          this.addInterpolated(parts, unlines);
          return parts.size;
        }
        str = (SIMPLESTR.lastIndex = index, SIMPLESTR).exec(code)[0] || this.carp("unterminated string");
        this.strnum(unlines(this.string(q, str.slice(1, -1))));
        return this.countLines(str).length;
      };
      exports.doHeredoc = function(code, index, q) {
        var end, raw, doc, parts, tabs, i$, len$, i2, t;
        if (q === "'") {
          ~(end = code.indexOf(q + q + q, index + 3)) || this.carp("unterminated heredoc");
          raw = code.slice(index + 3, end);
          doc = raw.replace(LASTDENT, "");
          this.strnum(enlines(this.string(q, lchomp(detab(doc, heretabs(doc))))));
          return this.countLines(raw).length + 6;
        }
        parts = this.interpolate(code, index, q + q + q);
        tabs = heretabs(code.slice(index + 3, index + parts.size - 3).replace(LASTDENT, ""));
        for (i$ = 0, len$ = parts.length; i$ < len$; ++i$) {
          i2 = i$;
          t = parts[i$];
          if (t[0] === "S") {
            if (i2 + 1 === parts.length) {
              t[1] = t[1].replace(LASTDENT, "");
            }
            t[1] = detab(t[1], tabs);
            if (i2 === 0) {
              t[1] = lchomp(t[1]);
            }
          }
        }
        this.addInterpolated(parts, enlines);
        return parts.size;
      };
      exports.doComment = function(code, index) {
        var comment, end, ref$;
        comment = ~(end = code.indexOf("*/", index + 2)) ? code.slice(index, end + 2) : code.slice(index) + "*/";
        if ((ref$ = this.last[0]) === "NEWLINE" || ref$ === "INDENT" || ref$ === "THEN") {
          this.token("COMMENT", detab(comment, this.dent));
          this.token("NEWLINE", "\n");
        }
        return this.countLines(comment).length;
      };
      exports.doJS = function(code, lastIndex) {
        var js, ref$;
        JSTOKEN.lastIndex = lastIndex;
        js = JSTOKEN.exec(code)[0] || this.carp("unterminated JS literal");
        this.token("LITERAL", (ref$ = Object(detab(js.slice(2, -2), this.dent)), ref$.js = true, ref$), true);
        return this.countLines(js).length;
      };
      exports.doRegex = function(code, index) {
        var divisible, ref$, input, body, flag;
        if (divisible = able(this.tokens) || this.last[0] === "CREMENT") {
          if (!this.last.spaced || ((ref$ = code.charAt(index + 1)) === " " || ref$ === "=")) {
            return 0;
          }
        }
        ref$ = (REGEX.lastIndex = index, REGEX).exec(code), input = ref$[0], body = ref$[1], flag = ref$[2];
        if (input) {
          this.regex(body, flag);
        } else if (!divisible && this.last[0] !== "(") {
          this.carp("unterminated regex");
        }
        return input.length;
      };
      exports.doHeregex = function(code, index) {
        var tokens, last, parts, rest, flag, i$, i2, t, dynaflag, len$, val, one;
        tokens = this.tokens, last = this.last;
        parts = this.interpolate(code, index, "//");
        rest = code.slice(index + parts.size);
        flag = this.validate(/^(?:[gimy]{1,4}|[?$]?)/.exec(rest)[0]);
        if (parts[1]) {
          if (flag === "$") {
            this.adi();
            this.token("(", '"');
          } else {
            tokens.push(["ID", "RegExp", last[2], last[3]], ["CALL(", "", last[2], last[3]]);
            if (flag === "?") {
              for (i$ = parts.length - 1; i$ >= 0; --i$) {
                i2 = i$;
                t = parts[i$];
                if (t[0] === "TOKENS") {
                  dynaflag = parts.splice(i2, 1)[0][1];
                  break;
                }
              }
            }
          }
          for (i$ = 0, len$ = parts.length; i$ < len$; ++i$) {
            i2 = i$;
            t = parts[i$];
            if (t[0] === "TOKENS") {
              tokens.push.apply(tokens, t[1]);
            } else {
              val = deheregex(t[1]);
              if (one && !val) {
                continue;
              }
              one = tokens.push((t[0] = "STRNUM", t[1] = this.string("'", enslash(val)), t));
            }
            tokens.push(["+-", "+", tokens[tokens.length - 1][2], tokens[tokens.length - 1][3]]);
          }
          --tokens.length;
          if (dynaflag || flag >= "g") {
            this.token(",", ",");
            if (dynaflag) {
              tokens.push.apply(tokens, dynaflag);
            } else {
              this.token("STRNUM", "'" + flag + "'");
            }
          }
          this.token(flag === "$" ? ")" : ")CALL", "");
        } else {
          this.regex(reslash(deheregex(parts[0][1])), flag);
        }
        return parts.size + flag.length;
      };
      exports.doBackslash = function(code, lastIndex) {
        var ref$, input, word;
        BSTOKEN.lastIndex = lastIndex;
        ref$ = BSTOKEN.exec(code), input = ref$[0], word = ref$[1];
        if (word) {
          this.strnum(this.string("'", word));
        } else {
          this.countLines(input);
        }
        return input.length;
      };
      exports.doLine = function(code, index) {
        var ref$, input, tabs, length, last, that, delta, tag, val;
        ref$ = (MULTIDENT.lastIndex = index, MULTIDENT).exec(code), input = ref$[0], tabs = ref$[1];
        length = this.countLines(input).length;
        last = this.last;
        last.eol = true;
        last.spaced = true;
        if (index + length >= code.length) {
          return length;
        }
        if (that = tabs && (this.emender || (this.emender = RegExp("[^" + tabs.charAt() + "]"))).exec(tabs)) {
          this.carp("contaminated indent " + escape(that));
        }
        if (0 > (delta = tabs.length - this.dent)) {
          this.dedent(-delta);
          this.newline();
        } else {
          tag = last[0], val = last[1];
          if (tag === "ASSIGN" && ((ref$ = val + "") !== "=" && ref$ !== ":=" && ref$ !== "+=") || tag === "CREMENT" && val === "++" && (ref$ = this.tokens)[ref$.length - 2].spaced || (tag === "+-" || tag === "PIPE" || tag === "BACKPIPE" || tag === "COMPOSE" || tag === "DOT" || tag === "LOGIC" || tag === "MATH" || tag === "COMPARE" || tag === "RELATION" || tag === "SHIFT" || tag === "IN" || tag === "OF" || tag === "TO" || tag === "BY" || tag === "FROM" || tag === "EXTENDS" || tag === "IMPLEMENTS")) {
            return length;
          }
          if (delta) {
            this.indent(delta);
          } else {
            this.newline();
          }
        }
        this.fset("for", false);
        this.fset("by", false);
        return length;
      };
      exports.doSpace = function(code, lastIndex) {
        var input;
        SPACE.lastIndex = lastIndex;
        if (input = SPACE.exec(code)[0]) {
          this.last.spaced = true;
        }
        return input.length;
      };
      exports.doCase = function() {
        var ref$, ref1$;
        this.fset("for", false);
        if ((ref$ = this.last[0]) === "ASSIGN" || ref$ === "->" || ref$ === ":" || this.last[0] === "INDENT" && ((ref$ = (ref1$ = this.tokens)[ref1$.length - 2][0]) === "ASSIGN" || ref$ === "->" || ref$ === ":")) {
          this.token("SWITCH", "switch");
          return this.token("CASE", "case");
        }
      };
      exports.doLiteral = function(code, index) {
        var sym, tag, val, ref$, that;
        if (!(sym = (SYMBOL.lastIndex = index, SYMBOL).exec(code)[0])) {
          return 0;
        }
        switch (tag = val = sym) {
          case "|":
            tag = "CASE";
            if (this.doCase()) {
              return sym.length;
            }
            break;
          case "|>":
            tag = "PIPE";
            break;
          case "`":
            tag = "BACKTICK";
            break;
          case "<<":
          case ">>":
            tag = "COMPOSE";
            break;
          case "<|":
            tag = "BACKPIPE";
            break;
          case "+":
          case "-":
            tag = "+-";
            break;
          case "&&":
          case "||":
            tag = "LOGIC";
            break;
          case ".&.":
          case ".|.":
          case ".^.":
            tag = "BITWISE";
            break;
          case "^^":
            tag = "CLONE";
            break;
          case "**":
          case "^":
            tag = "POWER";
            break;
          case "?":
            if (this.last[0] === "(") {
              this.token("PARAM(", "(");
              this.token(")PARAM", ")");
              this.token("->", "->");
              this.token("ID", "it");
            } else {
              if (this.last.spaced) {
                tag = "LOGIC";
              }
            }
            break;
          case "/":
          case "%":
          case "%%":
            tag = "MATH";
            break;
          case "++":
          case "--":
            tag = "CREMENT";
            break;
          case "<<<":
          case "<<<<":
            tag = "IMPORT";
            break;
          case ";":
            tag = "NEWLINE";
            this.fset("by", false);
            break;
          case "..":
            this.token("LITERAL", "..", true);
            return 2;
          case ".":
            if (this.last[1] === "?") {
              this.last[0] = "?";
            }
            tag = "DOT";
            break;
          case ",":
            switch (this.last[0]) {
              case ",":
              case "[":
              case "(":
              case "CALL(":
                this.token("LITERAL", "void");
                break;
              case "FOR":
              case "OWN":
                this.token("ID", "");
            }
            break;
          case "!=":
          case "~=":
            if (!(able(this.tokens) || ((ref$ = this.last[0]) === "(" || ref$ === "CREMENT"))) {
              this.tokens.push(val === "!=" ? ["UNARY", "!", this.line, this.column] : ["UNARY", "~", this.line, this.column], ["ASSIGN", "=", this.line, this.column]);
              return 2;
            }
          // fallthrough
          case "!~=":
          case "==":
            val = (function() {
              switch (val) {
                case "~=":
                  return "==";
                case "!~=":
                  return "!=";
                case "==":
                  return "===";
                case "!=":
                  return "!==";
              }
            })();
            tag = "COMPARE";
            break;
          case "===":
          case "!==":
            val += "=";
          // fallthrough
          case "<":
          case ">":
          case "<=":
          case ">=":
          case "<==":
          case ">==":
          case ">>=":
          case "<<=":
            tag = "COMPARE";
            break;
          case ".<<.":
          case ".>>.":
          case ".>>>.":
          case "<?":
          case ">?":
            tag = "SHIFT";
            break;
          case "(":
            if (!((ref$ = this.last[0]) === "FUNCTION" || ref$ === "GENERATOR" || ref$ === "LET" || this.able(true) || this.last[1] === ".@")) {
              this.token("(", "(");
              this.closes.push(")");
              this.parens.push(this.last);
              return 1;
            }
            tag = "CALL(";
            this.closes.push(")CALL");
            break;
          case "[":
          case "{":
            this.adi();
            this.closes.push("]}".charAt(val === "{"));
            break;
          case "}":
            if (this.inter && val !== (ref$ = this.closes)[ref$.length - 1]) {
              this.rest = code.slice(index + 1);
              return 9e9;
            }
          // fallthrough
          case "]":
          case ")":
            if (tag === ")" && ((ref$ = this.last[0]) === "+-" || ref$ === "COMPARE" || ref$ === "LOGIC" || ref$ === "MATH" || ref$ === "POWER" || ref$ === "SHIFT" || ref$ === "BITWISE" || ref$ === "CONCAT" || ref$ === "COMPOSE" || ref$ === "RELATION" || ref$ === "PIPE" || ref$ === "BACKPIPE" || ref$ === "IMPORT" || ref$ === "CLONEPORT" || ref$ === "ASSIGN")) {
              (ref$ = this.tokens)[ref$.length - 1][0] = function() {
                switch (this.last[0]) {
                  case "RELATION":
                    return "BIOPR";
                  case "PIPE":
                    this.parameters(false, -1);
                    return "BIOPP";
                  default:
                    return "BIOP";
                }
              }.call(this);
            }
            if (")" === (tag = val = this.pair(val))) {
              this.lpar = this.parens.pop();
            }
            break;
          case "=":
          case ":":
            if (val === ":") {
              switch (this.last[0]) {
                case "ID":
                case "STRNUM":
                case ")":
                  break;
                case "...":
                  this.last[0] = "STRNUM";
                  break;
                default:
                  tag = "LABEL";
                  val = "";
              }
              this.token(tag, val);
              return sym.length;
            }
          // fallthrough
          case ":=":
          case "+=":
          case "-=":
          case "*=":
          case "/=":
          case "%=":
          case "%%=":
          case "<?=":
          case ">?=":
          case "**=":
          case "^=":
          case ".&.=":
          case ".|.=":
          case ".^.=":
          case ".<<.=":
          case ".>>.=":
          case ".>>>.=":
          case "++=":
          case "|>=":
            if (this.last[1] === "." || this.last[0] === "?" && this.adi()) {
              this.last[1] += val;
              return val.length;
            }
            if (this.last[0] === "LOGIC") {
              (val = Object(val)).logic = this.tokens.pop()[1];
            } else if ((val === "+=" || val === "-=") && !able(this.tokens) && ((ref$ = this.last[0]) !== "+-" && ref$ !== "UNARY" && ref$ !== "LABEL")) {
              this.token("UNARY", val.charAt());
              val = "=";
            }
            tag = "ASSIGN";
            break;
          case "::=":
            this.token("DOT", ".");
            this.token("ID", "prototype");
            this.token("IMPORT", "<<");
            return sym.length;
          case "*":
            if (this.last[0] === "FUNCTION") {
              this.last[0] = "GENERATOR";
              return sym.length;
            }
            if (that = ((ref$ = this.last[0]) === "NEWLINE" || ref$ === "INDENT" || ref$ === "THEN" || ref$ === "=>") && (INLINEDENT.lastIndex = index + 1, INLINEDENT).exec(code)[0].length) {
              this.tokens.push(["LITERAL", "void", this.line, this.column], ["ASSIGN", "=", this.line, this.column]);
              this.indent(index + that - 1 - this.dent - code.lastIndexOf("\n", index - 1));
              return that;
            }
            tag = able(this.tokens) || this.last[0] === "CREMENT" && able(this.tokens, this.tokens.length - 1) || this.last[0] === "(" ? "MATH" : "STRNUM";
            break;
          case "@":
            this.adi();
            if (this.last[0] === "DOT" && this.last[1] === "." && (ref$ = this.tokens)[ref$.length - 2][0] === "ID" && (ref$ = this.tokens)[ref$.length - 2][1] === "constructor") {
              this.tokens.pop();
              this.tokens.pop();
              this.token("LITERAL", "this", true);
              this.adi();
              this.token("ID", "constructor", true);
            } else {
              this.token("LITERAL", "this", true);
            }
            return 1;
          case "@@":
            this.adi();
            this.token("ID", "constructor", true);
            return 2;
          case "&":
            this.token("LITERAL", "arguments");
            return 1;
          case "!":
            switch (false) {
              default:
                if (!this.last.spaced) {
                  if (this.last[1] === "require") {
                    this.last[0] = "REQUIRE";
                    this.last[1] = "require!";
                  } else if (able(this.tokens, null, true)) {
                    this.token("CALL(", "!");
                    this.token(")CALL", ")");
                  } else if (this.last[1] === "typeof") {
                    this.last[1] = "classof";
                  } else if (this.last[1] === "delete") {
                    this.last[1] = "jsdelete";
                  } else {
                    break;
                  }
                  return 1;
                }
            }
            tag = "UNARY";
            break;
          case "|":
            tag = "BITWISE";
            break;
          case "~":
            if (this.dotcat(val)) {
              return 1;
            }
            tag = "UNARY";
            break;
          case "::":
            this.adi();
            val = "prototype";
            tag = "ID";
            break;
          case "=>":
            this.unline();
            this.fset("for", false);
            tag = "THEN";
            break;
          default:
            if (/^!?(?:--?|~~?)>>?\*?$/.test(val)) {
              this.parameters(tag = "->");
            } else if (/^\*?<(?:--?|~~?)!?$/.test(val)) {
              this.parameters(tag = "<-");
            } else {
              switch (val.charAt(0)) {
                case "(":
                  this.token("CALL(", "(");
                  tag = ")CALL";
                  val = ")";
                  break;
                case "<":
                  if (val.length < 4) {
                    this.carp("unterminated words");
                  }
                  this.token("WORDS", val.slice(2, -2), this.adi());
                  return this.countLines(val).length;
              }
            }
        }
        if ((tag === "+-" || tag === "COMPARE" || tag === "LOGIC" || tag === "MATH" || tag === "POWER" || tag === "SHIFT" || tag === "BITWISE" || tag === "CONCAT" || tag === "RELATION" || tag === "PIPE" || tag === "BACKPIPE" || tag === "COMPOSE" || tag === "IMPORT") && this.last[0] === "(") {
          tag = tag === "BACKPIPE" ? "BIOPBP" : "BIOP";
        }
        if (tag === "," || tag === "CASE" || tag === "PIPE" || tag === "BACKPIPE" || tag === "COMPOSE" || tag === "DOT" || tag === "LOGIC" || tag === "COMPARE" || tag === "MATH" || tag === "POWER" || tag === "IMPORT" || tag === "SHIFT" || tag === "BITWISE") {
          this.unline();
        }
        this.token(tag, val);
        return sym.length;
      };
      exports.token = function(tag, value, callable) {
        this.tokens.push(this.last = [tag, value, this.line, this.column]);
        if (callable) {
          this.last.callable = true;
        }
        return value;
      };
      exports.indent = function(delta) {
        this.dent += delta;
        this.dents.push(this.token("INDENT", delta));
        this.closes.push("DEDENT");
      };
      exports.dedent = function(debt) {
        var dent;
        this.dent -= debt;
        while (debt > 0 && (dent = this.dents.pop())) {
          if (debt < dent && !this.inter) {
            this.carp("unmatched dedent (" + debt + " for " + dent + ")");
          }
          this.pair("DEDENT");
          debt -= typeof dent === "number" ? this.token("DEDENT", dent) : dent;
        }
      };
      exports.newline = function() {
        var ref$;
        if (!(this.last[0] === "NEWLINE" && this.last[1] === "\n")) {
          this.tokens.push(this.last = (ref$ = ["NEWLINE", "\n", this.line, this.column], ref$.spaced = true, ref$));
        }
      };
      exports.unline = function() {
        var ref$;
        if (!this.tokens[1]) {
          return;
        }
        switch (this.last[0]) {
          case "INDENT":
            (ref$ = this.dents)[ref$.length - 1] += "";
          // fallthrough
          case "NEWLINE":
            this.tokens.length--;
        }
      };
      exports.parameters = function(arrow, offset) {
        var i$, ref$, i2, t, ref1$;
        if (this.last[0] === ")" && ")" === this.last[1]) {
          this.lpar[0] = "PARAM(";
          this.last[0] = ")PARAM";
          return;
        }
        if (arrow === "->") {
          this.token("PARAM(", "");
        } else {
          for (i$ = (ref$ = this.tokens).length - 1; i$ >= 0; --i$) {
            i2 = i$;
            t = ref$[i$];
            if ((ref1$ = t[0]) === "NEWLINE" || ref1$ === "INDENT" || ref1$ === "THEN" || ref1$ === "=>" || ref1$ === "(") {
              break;
            }
          }
          this.tokens.splice(i2 + 1, 0, ["PARAM(", "", t[2], t[3]]);
        }
        if (offset) {
          this.tokens.splice(this.tokens.length + offset, 0, [")PARAM", "", t[2], t[3]]);
        } else {
          this.token(")PARAM", "");
        }
      };
      exports.interpolate = function(str, idx, end) {
        var parts, end0, pos, i2, ref$, oldLine, oldColumn, ch, c1, id, stringified, length, tag, e, delta, nested, clone, ref1$;
        parts = [];
        end0 = end.charAt(0);
        pos = 0;
        i2 = -1;
        str = str.slice(idx + end.length);
        ref$ = [this.line, this.column], oldLine = ref$[0], oldColumn = ref$[1];
        this.countLines(end);
        while (ch = str.charAt(++i2)) {
          switch (ch) {
            case end0:
              if (end !== str.slice(i2, i2 + end.length)) {
                continue;
              }
              parts.push(["S", this.countLines(str.slice(0, i2)), oldLine, oldColumn]);
              this.countLines(end);
              return parts.size = pos + i2 + end.length * 2, parts;
            case "#":
              c1 = str.charAt(i2 + 1);
              id = c1 === "@" && c1 || (ID.lastIndex = i2 + 1, ID).exec(str)[1];
              if (!(id || c1 === "{")) {
                continue;
              }
              break;
            case "\\":
              ++i2;
            // fallthrough
            default:
              continue;
          }
          if (i2 || nested && !stringified) {
            stringified = parts.push(["S", this.countLines(str.slice(0, i2)), oldLine, oldColumn]);
            ref$ = [this.line, this.column], oldLine = ref$[0], oldColumn = ref$[1];
          }
          if (id) {
            length = id.length;
            if (id === "@") {
              id = "this";
            }
            if (id === "this") {
              tag = "LITERAL";
            } else {
              id = camelize(id);
              try {
                Function("'use strict'; var " + id);
              } catch (e$) {
                e = e$;
                this.carp("invalid variable interpolation '" + id + "'");
              }
              tag = "ID";
            }
            str = str.slice(delta = i2 + 1 + length);
            parts.push(["TOKENS", nested = [[tag, id, this.line, this.column]]]);
          } else {
            clone = (ref$ = clone$(exports), ref$.inter = true, ref$.emender = this.emender, ref$);
            nested = clone.tokenize(str.slice(i2 + 2), {
              line: this.line,
              column: this.column + 2,
              raw: true
            });
            delta = str.length - clone.rest.length;
            this.countLines(str.slice(i2, delta));
            str = clone.rest;
            while (((ref$ = nested[0]) != null ? ref$[0] : void 0) === "NEWLINE") {
              nested.shift();
            }
            if (nested.length) {
              nested.unshift(["(", "(", oldLine, oldColumn]);
              nested.push([")", ")", this.line, this.column - 1]);
              parts.push(["TOKENS", nested]);
            }
            ref1$ = [this.line, this.column], oldLine = ref1$[0], oldColumn = ref1$[1];
          }
          pos += delta;
          i2 = -1;
        }
        this.carp("missing `" + end + "`");
      };
      exports.addInterpolated = function(parts, nlines) {
        var tokens, last, ref$, left, right, joint, callable, i$, len$, i2, t;
        if (!parts[1]) {
          return this.strnum(nlines(this.string('"', parts[0][1])));
        }
        tokens = this.tokens, last = this.last;
        ref$ = !last.spaced && last[1] === "%" ? (--tokens.length, this.last = last = tokens[tokens.length - 1], ["[", "]", [",", ","]]) : ["(", ")", ["+-", "+"]], left = ref$[0], right = ref$[1], joint = ref$[2];
        callable = this.adi();
        tokens.push([left, '"', last[2], last[3]]);
        for (i$ = 0, len$ = parts.length; i$ < len$; ++i$) {
          i2 = i$;
          t = parts[i$];
          if (t[0] === "TOKENS") {
            tokens.push.apply(tokens, t[1]);
          } else {
            if (i2 > 1 && !t[1]) {
              continue;
            }
            tokens.push(["STRNUM", nlines(this.string('"', t[1])), t[2], t[3]]);
          }
          tokens.push(joint.concat(tokens[tokens.length - 1][2], tokens[tokens.length - 1][3]));
        }
        --tokens.length;
        this.token(right, "", callable);
      };
      exports.strnum = function(it) {
        this.token("STRNUM", it, this.adi() || this.last[0] === "DOT");
      };
      exports.regex = function(body, flag) {
        var e;
        try {
          RegExp(body);
        } catch (e$) {
          e = e$;
          this.carp(e.message);
        }
        if (flag === "$") {
          return this.strnum(this.string("'", enslash(body)));
        }
        return this.token("LITERAL", "/" + (body || "(?:)") + "/" + this.validate(flag));
      };
      exports.adi = function() {
        if (this.last.spaced) {
          return;
        }
        if (!able(this.tokens)) {
          return;
        }
        return this.token("DOT", ".");
      };
      exports.dotcat = function(it) {
        if (this.last[1] === "." || this.adi()) {
          return this.last[1] += it;
        }
      };
      exports.pair = function(it) {
        var wanted, ref$;
        if (!(it === (wanted = (ref$ = this.closes)[ref$.length - 1]) || ")CALL" === wanted && it === ")")) {
          if ("DEDENT" !== wanted) {
            this.carp("unmatched `" + it + "`");
          }
          this.dedent((ref$ = this.dents)[ref$.length - 1]);
          return this.pair(it);
        }
        this.unline();
        this.fclear();
        return this.closes.pop();
      };
      exports.able = function(call) {
        return !this.last.spaced && able(this.tokens, null, call);
      };
      exports.countLines = function(it) {
        var pos;
        if (!this.isAtPrefix) {
          this.column += it.length;
        }
        while (pos = 1 + it.indexOf("\n", pos)) {
          if (!this.isAtPrefix) {
            this.column = 0;
          }
          this.column += it.length - pos;
          ++this.line;
          this.isAtPrefix = false;
        }
        this.charsCounted += it.length;
        return it;
      };
      exports.forange = function() {
        var ref$, ref1$, ref2$;
        if (((ref$ = (ref1$ = this.tokens)[ref1$.length - 2 - ((ref2$ = this.last[0]) === "NEWLINE" || ref2$ === "INDENT")]) != null ? ref$[0] : void 0) === "FOR" || this.last[0] === "FOR") {
          this.fset("for", false);
          this.fset("from", true);
          return true;
        } else {
          return false;
        }
      };
      exports.validate = function(flag) {
        var that;
        if (that = flag && /(.).*\1/.exec(flag)) {
          this.carp("duplicate regex flag `" + that[1] + "`");
        }
        return flag;
      };
      exports.fget = function(key) {
        var ref$;
        return (ref$ = this.flags[this.closes.length]) != null ? ref$[key] : void 0;
      };
      exports.fset = function(key, val) {
        var ref$, key$;
        ((ref$ = this.flags)[key$ = this.closes.length] || (ref$[key$] = {}))[key] = val;
      };
      exports.fclear = function() {
        this.flags.splice(this.closes.length);
      };
      exports.carp = function(it) {
        carp(it, this.line);
      };
      exports.string = function(q, body) {
        return string(q, body, this.line);
      };
      function carp(msg, lno) {
        throw SyntaxError(msg + " on line " + -~lno);
      }
      function able(tokens, i2, call) {
        var token, tag;
        i2 == null && (i2 = tokens.length);
        tag = (token = tokens[i2 - 1])[0];
        return tag === "ID" || tag === "]" || tag === "?" || (call ? token.callable || (tag === ")" || tag === ")CALL" || tag === "BIOPBP") && token[1] : tag === "}" || tag === ")" || tag === ")CALL" || tag === "STRNUM" || tag === "LITERAL" || tag === "WORDS");
      }
      string = function(re) {
        return function(q, body, lno) {
          body = body.replace(re, function(it, oct, xu, rest) {
            if (it === q || it === "\\") {
              return "\\" + it;
            }
            if (oct) {
              return "\\x" + (256 + parseInt(oct, 8)).toString(16).slice(1);
            }
            if (xu) {
              carp("malformed character escape sequence", lno);
            }
            if (!rest || q === rest) {
              return it;
            } else {
              return rest;
            }
          });
          return q + body + q;
        };
      }.call(exports, /['"]|\\(?:([0-3]?[0-7]{2}|[1-7]|0(?=[89]))|x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|([xu])|[\\0bfnrtv]|[^\n\S]|([\w\W]))?/g);
      function heretabs(doc) {
        var dent, that, ref$;
        dent = 0 / 0;
        while (that = TABS.exec(doc)) {
          dent <= (ref$ = that[0].length - 1) || (dent = ref$);
        }
        return dent;
      }
      TABS = /\n(?!$)[^\n\S]*/mg;
      function detab(str, len) {
        if (len) {
          return str.replace(detab[len] || (detab[len] = RegExp("\\n[^\\n\\S]{1," + len + "}", "g")), "\n");
        } else {
          return str;
        }
      }
      unlines = function(it) {
        return it.replace(/\n[^\n\S]*/g, "");
      };
      enlines = function(it) {
        return it.replace(/\n/g, "\\n");
      };
      enslash = function(it) {
        return it.replace(/\\/g, "\\\\");
      };
      reslash = function(it) {
        return it.replace(/(\\.)|\//g, function() {
          return arguments[1] || "\\/";
        });
      };
      camelize = function(it) {
        return it.replace(/-[a-z]/ig, function(it2) {
          return it2.charAt(1).toUpperCase();
        });
      };
      deheregex = function(it) {
        return it.replace(/\s+(?:#.*)?|(\\[\s\S])/g, function(arg$, bs) {
          bs || (bs = "");
          if ("\n" === bs.charAt(1)) {
            return "\\n";
          } else {
            return bs;
          }
        });
      };
      function lchomp(it) {
        return it.slice(1 + it.lastIndexOf("\n", 0));
      }
      function decode(val, lno) {
        if (!isNaN(val)) {
          return [+val];
        }
        val = val.length > 8 ? "ng" : Function("return " + val)();
        val.length === 1 || carp("bad string in range", lno);
        return [val.charCodeAt(), true];
      }
      function uxxxx(it) {
        return '"\\u' + ("000" + it.toString(16)).slice(-4) + '"';
      }
      character = typeof JSON == "undefined" || JSON === null ? uxxxx : function(it) {
        switch (it) {
          case 8232:
          case 8233:
            return uxxxx(it);
          default:
            return JSON.stringify(String.fromCharCode(it));
        }
      };
      function firstPass(tokens) {
        var prev, i2, token, tag, val, line, column, next, parens, i$, j, ts, ref$;
        prev = ["NEWLINE", "\n", 0];
        i2 = 0;
        while (token = tokens[++i2]) {
          tag = token[0], val = token[1], line = token[2], column = token[3];
          switch (tag) {
            case "ASSIGN":
              if (in$(prev[1], LS_KEYWORDS) && tokens[i2 - 2][0] !== "DOT") {
                carp("cannot assign to reserved word '" + prev[1] + "'", line);
              }
              break;
            case "DOT":
              switch (false) {
                case !(prev[0] === "]" && tokens[i2 - 2][0] === "[" && tokens[i2 - 3][0] === "DOT"):
                  tokens.splice(i2 - 2, 3);
                  tokens[i2 - 3][1] = "[]";
                  i2 -= 3;
                  break;
                case !(prev[0] === "}" && tokens[i2 - 2][0] === "{" && tokens[i2 - 3][0] === "DOT"):
                  tokens.splice(i2 - 2, 3);
                  tokens[i2 - 3][1] = "{}";
                  i2 -= 3;
                  break;
                case !(val === "." && token.spaced && prev.spaced):
                  tokens[i2] = ["COMPOSE", "<<", line, column];
                  break;
                default:
                  next = tokens[i2 + 1];
                  if (prev[0] === "(" && next[0] === ")") {
                    tokens[i2][0] = "BIOP";
                  } else if (prev[0] === "(") {
                    tokens.splice(i2, 0, ["PARAM(", "(", line, column], [")PARAM", ")", line, column], ["->", "~>", line, column], ["ID", "it", line, column]);
                  } else if (next[0] === ")") {
                    tokens.splice(i2 + 1, 0, ["[", "[", line, column], ["ID", "it", line, column], ["]", "]", line, column]);
                    parens = 1;
                    LOOP: for (i$ = i2 + 1; i$ >= 0; --i$) {
                      j = i$;
                      switch (tokens[j][0]) {
                        case ")":
                          ++parens;
                          break;
                        case "(":
                          if (--parens === 0) {
                            tokens.splice(j + 1, 0, ["PARAM(", "(", line, column], ["ID", "it", line, column], [")PARAM", ")", line, column], ["->", "~>", line, column]);
                            break LOOP;
                          }
                      }
                    }
                  }
              }
              break;
            case "CREMENT":
              if (!(val === "++" && (next = tokens[i2 + 1]))) {
                break;
              }
              ts = ["ID", "LITERAL", "STRNUM"];
              if (prev.spaced && token.spaced || !(prev.spaced || token.spaced) && in$(prev[0], ts) && in$(next[0], ts)) {
                tokens[i2][0] = "CONCAT";
              }
              if (prev[0] === "(" && next[0] === ")" || prev[0] === "(" && token.spaced || next[0] === ")" && prev.spaced) {
                tokens[i2][0] = "BIOP";
              }
              break;
            case "ID":
              if (val !== "async") {
                break;
              }
              next = tokens[i2 + 1];
              if ((ref$ = next[0]) === "FUNCTION" || ref$ === "GENERATOR") {
                token[0] = "ASYNC";
              }
          }
          prev = token;
          continue;
        }
      }
      function rewriteBlockless(tokens) {
        var i2, token, tag;
        i2 = -1;
        while (token = tokens[++i2]) {
          tag = token[0];
          if (tag === "IF" || tag === "CLASS" || tag === "CATCH") {
            detectEnd(tokens, i2 + 1, ok, go);
          }
        }
        function ok(it) {
          var ref$;
          return (ref$ = it[0]) === "NEWLINE" || ref$ === "INDENT";
        }
        function go(it, i3) {
          var lno, cno;
          if (tag === "IF") {
            if (it[0] !== "INDENT" || !it[1] && !it.then || in$(tokens[i3 - 1][0], BLOCK_USERS)) {
              token[0] = "POST_IF";
            }
          } else if (it[0] !== "INDENT") {
            tokens.splice(i3, 0, ["INDENT", 0, lno = tokens[i3 - 1][2], cno = tokens[i3 - 1][3]], ["DEDENT", 0, lno, cno]);
          }
        }
      }
      function addImplicitIndentation(tokens) {
        var i2, token, tag, next, indent, dedent, ref$, ref1$, idx;
        i2 = 0;
        while (token = tokens[++i2]) {
          tag = token[0];
          if (tag !== "->" && tag !== "THEN" && tag !== "ELSE" && tag !== "DEFAULT" && tag !== "TRY" && tag !== "FINALLY" && tag !== "DECL") {
            continue;
          }
          switch (next = tokens[i2 + 1][0]) {
            case "IF":
              if (tag === "ELSE") {
                continue;
              }
              break;
            case "INDENT":
            case "THEN":
              if (tag === "THEN") {
                tokens.splice(i2--, 1);
              }
              continue;
          }
          indent = ["INDENT", 0, token[2], token[3]];
          dedent = ["DEDENT", 0];
          if (tag === "THEN") {
            (tokens[i2] = indent).then = true;
          } else {
            tokens.splice(++i2, 0, indent);
          }
          switch (false) {
            case tag !== "DECL":
              break;
            case (next !== "DOT" && next !== "?" && next !== "," && next !== "PIPE" && next !== "BACKPIPE"):
              --i2;
            // fallthrough
            case !((next === "ID" || next === "STRNUM" || next === "LITERAL") && "," === ((ref$ = tokens[i2 + 2]) != null ? ref$[0] : void 0)):
              go(0, i2 += 2);
              ++i2;
              continue;
            case !((next === "(" || next === "[" || next === "{") && "," === ((ref1$ = tokens[idx = 1 + indexOfPair(tokens, i2 + 1)]) != null ? ref1$[0] : void 0)):
              go(0, idx);
              ++i2;
              continue;
          }
          detectEnd(tokens, i2 + 1, ok, go);
        }
        function ok(token2, i3) {
          var t0, t;
          t0 = token2[0];
          t = tag;
          if (tag === t0 || tag === "THEN" && t0 === "SWITCH") {
            tag = "";
          }
          switch (t0) {
            case "NEWLINE":
              return token2[1] !== ";";
            case "DOT":
            case "?":
            case ",":
            case "PIPE":
            case "BACKPIPE":
              return tokens[i3 - 1].eol;
            case "ELSE":
              return t === "THEN";
            case "CATCH":
              return t === "TRY";
            case "FINALLY":
              return t === "TRY" || t === "CATCH" || t === "THEN";
            case "CASE":
            case "DEFAULT":
              return t === "CASE" || t === "THEN";
          }
        }
        function go(arg$, i3) {
          var prev;
          prev = tokens[i3 - 1];
          tokens.splice(prev[0] === "," ? i3 - 1 : i3, 0, (dedent[2] = prev[2], dedent[3] = prev[3], dedent));
        }
      }
      function addImplicitParentheses(tokens) {
        var i2, brackets, token, endi, ref$, tpair, tag, prev, ref1$, skipBlock, seenSwitch;
        i2 = 0;
        brackets = [];
        while (token = tokens[++i2]) {
          if (token[1] === "do" && tokens[i2 + 1][0] === "INDENT") {
            endi = indexOfPair(tokens, i2 + 1);
            if (tokens[endi + 1][0] === "NEWLINE" && ((ref$ = tokens[endi + 2]) != null ? ref$[0] : void 0) === "WHILE") {
              token[0] = "DO";
              tokens[endi + 2].done = true;
              tokens.splice(endi + 1, 1);
            } else {
              (token = tokens[1 + i2])[0] = "(";
              (tpair = tokens[endi])[0] = ")";
              token.doblock = true;
              tokens.splice(i2, 1);
            }
          }
          tag = token[0];
          prev = tokens[i2 - 1];
          tag === "[" && brackets.push(prev[0] === "DOT");
          if (prev[0] === "]") {
            if (brackets.pop()) {
              prev.index = true;
            } else {
              continue;
            }
          }
          if (!((ref1$ = prev[0]) === "FUNCTION" || ref1$ === "GENERATOR" || ref1$ === "LET" || ref1$ === "WHERE" || prev.spaced && able(tokens, i2, true))) {
            continue;
          }
          if (token.doblock) {
            token[0] = "CALL(";
            tpair[0] = ")CALL";
            continue;
          }
          if (!exp(token)) {
            continue;
          }
          if (tag === "CREMENT") {
            if (token.spaced || !in$((ref1$ = tokens[i2 + 1]) != null ? ref1$[0] : void 0, CHAIN)) {
              continue;
            }
          }
          skipBlock = seenSwitch = false;
          tokens.splice(i2++, 0, ["CALL(", "", token[2], token[3]]);
          detectEnd(tokens, i2, ok, go);
        }
        function exp(token2) {
          var tag2;
          tag2 = token2[0];
          return in$(tag2, ARG) || !token2.spaced && (tag2 === "+-" || tag2 === "CLONE");
        }
        function ok(token2, i3) {
          var tag2, ref$2, pre;
          tag2 = token2[0];
          if (tag2 === "POST_IF" || tag2 === "PIPE" || tag2 === "BACKPIPE") {
            return true;
          }
          if (!skipBlock) {
            if (token2.alias && ((ref$2 = token2[1]) === "&&" || ref$2 === "||" || ref$2 === "xor") || (tag2 === "TO" || tag2 === "BY" || tag2 === "IMPLEMENTS")) {
              return true;
            }
          }
          pre = tokens[i3 - 1];
          switch (tag2) {
            case "NEWLINE":
              return pre[0] !== ",";
            case "DOT":
            case "?":
              return !skipBlock && (pre.spaced || pre[0] === "DEDENT");
            case "SWITCH":
              seenSwitch = true;
            // fallthrough
            case "IF":
            case "CLASS":
            case "FUNCTION":
            case "GENERATOR":
            case "LET":
            case "WITH":
            case "CATCH":
              skipBlock = true;
              break;
            case "CASE":
              if (seenSwitch) {
                skipBlock = true;
              } else {
                return true;
              }
              break;
            case "INDENT":
              if (skipBlock) {
                return skipBlock = false;
              }
              return !in$(pre[0], BLOCK_USERS);
            case "WHILE":
              if (token2.done) {
                return false;
              }
            // fallthrough
            case "FOR":
              skipBlock = true;
              return able(tokens, i3) || pre[0] === "CREMENT" || pre[0] === "..." && pre.spaced;
          }
          return false;
        }
        function go(token2, i3) {
          tokens.splice(i3, 0, [")CALL", "", tokens[i3 - 1][2], tokens[i3 - 1][3]]);
        }
      }
      function addImplicitBraces(tokens) {
        var stack, i2, token, tag, start, paren, index, pre, ref$, inline, ref1$;
        stack = [];
        i2 = 0;
        while (token = tokens[++i2]) {
          if (":" !== (tag = token[0])) {
            switch (false) {
              case !in$(tag, CLOSERS):
                start = stack.pop();
                break;
              case !in$(tag, OPENERS):
                if (tag === "INDENT" && tokens[i2 - 1][0] === "{") {
                  tag = "{";
                }
                stack.push([tag, i2]);
            }
            continue;
          }
          paren = tokens[i2 - 1][0] === ")";
          index = paren ? start[1] : i2 - 1;
          pre = tokens[index - 1];
          if (!((ref$ = pre[0]) === ":" || ref$ === "ASSIGN" || ref$ === "IMPORT" || ((ref$ = stack[stack.length - 1]) != null ? ref$[0] : void 0) !== "{")) {
            continue;
          }
          stack.push(["{"]);
          inline = !pre.doblock && ((ref1$ = pre[0]) !== "NEWLINE" && ref1$ !== "INDENT");
          while (((ref1$ = tokens[index - 2]) != null ? ref1$[0] : void 0) === "COMMENT") {
            index -= 2;
          }
          tokens.splice(index, 0, ["{", "{", tokens[index][2], tokens[index][3]]);
          detectEnd(tokens, ++i2 + 1, ok, go);
        }
        function ok(token2, i3) {
          var tag2, t1, ref$2, ref1$2;
          switch (tag2 = token2[0]) {
            case ",":
              break;
            case "NEWLINE":
              if (inline) {
                return true;
              }
              break;
            case "DEDENT":
              return true;
            case "POST_IF":
            case "FOR":
            case "WHILE":
              return inline;
            default:
              return false;
          }
          t1 = (ref$2 = tokens[i3 + 1]) != null ? ref$2[0] : void 0;
          return t1 !== (tag2 === "," ? "NEWLINE" : "COMMENT") && ":" !== ((ref1$2 = tokens[t1 === "(" ? 1 + indexOfPair(tokens, i3 + 1) : i3 + 2]) != null ? ref1$2[0] : void 0);
        }
        function go(token2, i3) {
          tokens.splice(i3, 0, ["}", "", token2[2], token2[3]]);
        }
      }
      function expandLiterals(tokens) {
        var i2, fromNum, token, sig, ref$, ref1$, lno, cno, ref2$, ref3$, ref4$, char, toNum, tochar, byNum, byp, ref5$, ts, enc, add, i$, n, ref6$, ref7$, len$, word, that;
        i2 = 0;
        while (token = tokens[++i2]) {
          switch (token[0]) {
            case "STRNUM":
              if (~"-+".indexOf(sig = token[1].charAt(0))) {
                token[1] = token[1].slice(1);
                tokens.splice(i2++, 0, ["+-", sig, token[2], token[3]]);
              }
              if (token.callable) {
                continue;
              }
              break;
            case "TO":
            case "TIL":
              if (!(tokens[i2 - 1][0] === "[" && (tokens[i2 + 2][0] === "]" && ((ref$ = tokens[i2 + 1][1].charAt(0)) === "'" || ref$ === '"' || +tokens[i2 + 1][1] >= 0) || tokens[i2 + 2][0] === "BY" && ((ref$ = tokens[i2 + 3]) != null ? ref$[0] : void 0) === "STRNUM" && ((ref1$ = tokens[i2 + 4]) != null ? ref1$[0] : void 0) === "]"))) {
                continue;
              }
              if (tokens[i2 + 2][0] === "BY") {
                tokens[i2 + 2][0] = "RANGE_BY";
              }
              token.op = token[1];
              fromNum = 0;
            // fallthrough
            case "RANGE":
              lno = token[2];
              cno = token[3];
              if (fromNum != null || tokens[i2 - 1][0] === "[" && tokens[i2 + 1][0] === "STRNUM" && (tokens[i2 + 2][0] === "]" && ((ref2$ = tokens[i2 + 1][1].charAt(0)) === "'" || ref2$ === '"' || +tokens[i2 + 1][1] >= 0) || tokens[i2 + 2][0] === "RANGE_BY" && ((ref2$ = tokens[i2 + 3]) != null ? ref2$[0] : void 0) === "STRNUM" && ((ref3$ = tokens[i2 + 4]) != null ? ref3$[0] : void 0) === "]")) {
                if (fromNum == null) {
                  ref4$ = decode(token[1], lno), fromNum = ref4$[0], char = ref4$[1];
                }
                ref4$ = decode(tokens[i2 + 1][1], lno), toNum = ref4$[0], tochar = ref4$[1];
                if (toNum == null || char ^ tochar) {
                  carp('bad "to" in range', lno);
                }
                byNum = 1;
                if (byp = ((ref4$ = tokens[i2 + 2]) != null ? ref4$[0] : void 0) === "RANGE_BY") {
                  if (!(byNum = +((ref5$ = tokens[i2 + 3]) != null ? ref5$[1] : void 0))) {
                    carp('bad "by" in range', tokens[i2 + 2][2]);
                  }
                } else if (fromNum > toNum) {
                  byNum = -1;
                }
                ts = [];
                enc = char ? character : String;
                add = fn$;
                if (token.op === "to") {
                  for (i$ = fromNum; byNum < 0 ? i$ >= toNum : i$ <= toNum; i$ += byNum) {
                    n = i$;
                    add();
                  }
                } else {
                  for (i$ = fromNum; byNum < 0 ? i$ > toNum : i$ < toNum; i$ += byNum) {
                    n = i$;
                    add();
                  }
                }
                ts.pop() || carp("empty range", lno);
                tokens.splice.apply(tokens, [i2, 2 + 2 * byp].concat(arrayFrom$(ts)));
                i2 += ts.length - 1;
              } else {
                token[0] = "STRNUM";
                if (((ref6$ = tokens[i2 + 2]) != null ? ref6$[0] : void 0) === "RANGE_BY") {
                  tokens.splice(i2 + 2, 1, ["BY", "by", lno, cno]);
                }
                tokens.splice(i2 + 1, 0, ["TO", token.op, lno, cno]);
              }
              fromNum = null;
              break;
            case "WORDS":
              ts = [["[", "[", lno = token[2], cno = token[3]]];
              for (i$ = 0, len$ = (ref7$ = token[1].match(/\S+/g) || "").length; i$ < len$; ++i$) {
                word = ref7$[i$];
                ts.push(["STRNUM", string("'", word, lno), lno, cno], [",", ",", lno, cno]);
              }
              tokens.splice.apply(tokens, [i2, 1].concat(arrayFrom$(ts), [["]", "]", lno, cno]]));
              i2 += ts.length;
              break;
            case "INDENT":
              if (that = tokens[i2 - 1]) {
                if (that[1] === "new") {
                  tokens.splice(i2++, 0, ["PARAM(", "", token[2], token[3]], [")PARAM", "", token[2], token[3]], ["->", "", token[2], token[3]]);
                } else if ((ref7$ = that[0]) === "FUNCTION" || ref7$ === "GENERATOR" || ref7$ === "LET") {
                  tokens.splice(i2, 0, ["CALL(", "", token[2], token[3]], [")CALL", "", token[2], token[3]]);
                  i2 += 2;
                }
              }
              continue;
            case "LITERAL":
            case "}":
              break;
            case ")":
            case ")CALL":
              if (token[1]) {
                continue;
              }
              break;
            case "]":
              if (token.index) {
                continue;
              }
              break;
            case "CREMENT":
              if (!able(tokens, i2)) {
                continue;
              }
              break;
            case "BIOP":
              if (!token.spaced && ((ref7$ = token[1]) === "+" || ref7$ === "-") && tokens[i2 + 1][0] !== ")") {
                tokens[i2][0] = "+-";
              }
              continue;
            default:
              continue;
          }
          if (token.spaced && in$(tokens[i2 + 1][0], ARG)) {
            tokens.splice(++i2, 0, [",", ",", token[2], token[3]]);
          }
        }
        function fn$() {
          if (65536 < ts.push(["STRNUM", enc(n), lno, cno], [",", ",", lno, cno])) {
            carp("range limit exceeded", lno);
          }
        }
      }
      function detectEnd(tokens, i2, ok, go) {
        var levels, token, tag;
        levels = 0;
        for (; token = tokens[i2]; ++i2) {
          if (!levels && ok(token, i2)) {
            return go(token, i2);
          }
          tag = token[0];
          if (0 > (levels += in$(tag, OPENERS) || -in$(tag, CLOSERS))) {
            return go(token, i2);
          }
        }
      }
      function indexOfPair(tokens, i2) {
        var level, end, start, that;
        level = 1;
        end = INVERSES[start = tokens[i2][0]];
        while (that = tokens[++i2]) {
          switch (that[0]) {
            case start:
              ++level;
              break;
            case end:
              if (!--level) {
                return i2;
              }
          }
        }
        return -1;
      }
      KEYWORDS_SHARED = ["true", "false", "null", "this", "void", "super", "return", "throw", "break", "continue", "if", "else", "for", "while", "switch", "case", "default", "try", "catch", "finally", "function", "class", "extends", "implements", "new", "do", "delete", "typeof", "in", "instanceof", "let", "with", "var", "const", "import", "export", "debugger", "yield"];
      KEYWORDS_UNUSED = ["enum", "interface", "package", "private", "protected", "public", "static"];
      JS_KEYWORDS = KEYWORDS_SHARED.concat(KEYWORDS_UNUSED);
      LS_KEYWORDS = ["xor", "match", "where"];
      ID = /((?!\s)[a-z_$\xAA-\uFFDC](?:(?!\s)[\w$\xAA-\uFFDC]|-[a-z])*)([^\n\S]*:(?![:=]))?|/ig;
      SYMBOL = /[-\/^]=|[%+:*]{1,2}=|\|>=|\.(?:[&\|\^]|<<|>>>?)\.=?|\.{1,3}|\^\^|\*?<(?:--?|~~?)!?|!?(?:--?|~~?)>>?\*?|([-+&|:])\1|%%|&|\([^\n\S]*\)|[!=]==?|!?\~=|@@?|<\[(?:[\s\S]*?\]>)?|<<<<?|<\||[<>]==|<<=|>>=|<<|>>|[<>]\??=?|\|>|\||=>|\*\*|\^|`|[^\s#]?/g;
      SPACE = /[^\n\S]*(?:#.*)?/g;
      MULTIDENT = /(?:\s*#.*)*(?:\n([^\n\S]*))*/g;
      SIMPLESTR = /'[^\\']*(?:\\[\s\S][^\\']*)*'|/g;
      JSTOKEN = /``[^\\`]*(?:\\[\s\S][^\\`]*)*``|/g;
      BSTOKEN = RegExp("\\\\(?:(\\S[^\\s,;)}\\]]*)|(?:" + SPACE.source + "\\n?)*)", "g");
      NUMBER = /0x[\dA-Fa-f][\dA-Fa-f_]*|(\d*)~([\dA-Za-z]\w*)|((\d[\d_]*)(\.\d[\d_]*)?(?:e[+-]?\d[\d_]*)?)[$\w]*|/g;
      NUMBER_OMIT = /_+/g;
      REGEX = /\/([^[\/\n\\]*(?:(?:\\.|\[[^\]\n\\]*(?:\\.[^\]\n\\]*)*\])[^[\/\n\\]*)*)\/([gimy]{1,4}|\$?)|/g;
      HEREGEX_OMIT = /\s+(?:#.*)?/g;
      LASTDENT = /\n[^\n\S]*$/;
      INLINEDENT = /[^\n\S]*[^#\s]?/g;
      NONASCII = /[\x80-\uFFFF]/;
      OPENERS = ["(", "[", "{", "CALL(", "PARAM(", "INDENT"];
      CLOSERS = [")", "]", "}", ")CALL", ")PARAM", "DEDENT"];
      INVERSES = import$((function() {
        var i$, ref$, len$, resultObj$ = {};
        for (i$ = 0, len$ = (ref$ = OPENERS).length; i$ < len$; ++i$) {
          i = i$;
          o = ref$[i$];
          resultObj$[o] = CLOSERS[i];
        }
        return resultObj$;
      })(), (function() {
        var i$, ref$, len$, resultObj$ = {};
        for (i$ = 0, len$ = (ref$ = CLOSERS).length; i$ < len$; ++i$) {
          i = i$;
          c = ref$[i$];
          resultObj$[c] = OPENERS[i];
        }
        return resultObj$;
      })());
      CHAIN = ["(", "{", "[", "ID", "STRNUM", "LITERAL", "LET", "WITH", "WORDS"];
      ARG = CHAIN.concat(["...", "UNARY", "YIELD", "CREMENT", "PARAM(", "FUNCTION", "GENERATOR", "IF", "SWITCH", "TRY", "CLASS", "RANGE", "LABEL", "DECL", "DO", "BIOPBP"]);
      BLOCK_USERS = [",", ":", "->", "ELSE", "ASSIGN", "IMPORT", "UNARY", "DEFAULT", "TRY", "FINALLY", "HURL", "DECL", "DO", "LET", "FUNCTION", "GENERATOR", "..."];
      function clone$(it) {
        function fun() {
        }
        fun.prototype = it;
        return new fun();
      }
      function in$(x, xs) {
        var i2 = -1, l = xs.length >>> 0;
        while (++i2 < l) if (x === xs[i2]) return true;
        return false;
      }
      function import$(obj, src) {
        var own = {}.hasOwnProperty;
        for (var key in src) if (own.call(src, key)) obj[key] = src[key];
        return obj;
      }
    }
  });

  // ../../stub-fs.js
  var require_stub_fs = __commonJS({
    "../../stub-fs.js"(exports, module) {
      init_shim_buffer();
      module.exports = { readFileSync() {
        throw new Error("no fs in the browser");
      }, existsSync() {
        return false;
      } };
    }
  });

  // ../../stub-path.js
  var require_stub_path = __commonJS({
    "../../stub-path.js"(exports, module) {
      init_shim_buffer();
      var norm = (p) => String(p || "");
      module.exports = {
        basename: (p, ext) => {
          let b = norm(p).split("/").pop();
          if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
          return b;
        },
        dirname: (p) => norm(p).split("/").slice(0, -1).join("/") || ".",
        extname: (p) => {
          const b = norm(p).split("/").pop();
          const i = b.lastIndexOf(".");
          return i > 0 ? b.slice(i) : "";
        },
        join: (...a) => a.filter(Boolean).join("/").replace(/\/+/g, "/"),
        resolve: (...a) => a.filter(Boolean).join("/").replace(/\/+/g, "/"),
        sep: "/"
      };
    }
  });

  // lib/parser.js
  var require_parser = __commonJS({
    "lib/parser.js"(exports, module) {
      init_shim_buffer();
      var parser = (function() {
        var o = function(k, v, o2, l) {
          for (o2 = o2 || {}, l = k.length; l--; o2[k[l]] = v) ;
          return o2;
        }, $V0 = [2, 60], $V1 = [1, 31], $V2 = [1, 34], $V3 = [1, 35], $V4 = [1, 36], $V5 = [1, 37], $V6 = [1, 38], $V7 = [1, 8], $V8 = [1, 15], $V9 = [1, 14], $Va = [1, 39], $Vb = [1, 41], $Vc = [1, 29], $Vd = [1, 6], $Ve = [1, 10], $Vf = [1, 9], $Vg = [1, 11], $Vh = [1, 16], $Vi = [1, 17], $Vj = [1, 18], $Vk = [1, 19], $Vl = [1, 20], $Vm = [1, 21], $Vn = [1, 22], $Vo = [1, 23], $Vp = [1, 44], $Vq = [1, 24], $Vr = [1, 25], $Vs = [1, 26], $Vt = [1, 27], $Vu = [1, 28], $Vv = [1, 30], $Vw = [1, 43], $Vx = [1, 45], $Vy = [1, 20, 25, 47], $Vz = [20, 47], $VA = [2, 64], $VB = [1, 49], $VC = [1, 50], $VD = [1, 51], $VE = [1, 52], $VF = [1, 53], $VG = [1, 54], $VH = [1, 55], $VI = [1, 56], $VJ = [1, 57], $VK = [1, 58], $VL = [1, 59], $VM = [1, 60], $VN = [1, 61], $VO = [1, 62], $VP = [1, 63], $VQ = [30, 46, 47, 48], $VR = [2, 50], $VS = [1, 68], $VT = [1, 67], $VU = [1, 12, 19, 20, 22, 24, 25, 26, 30, 33, 34, 35, 46, 47, 48, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 79, 81, 82, 102, 105], $VV = [2, 75], $VW = [1, 77], $VX = [1, 78], $VY = [1, 73], $VZ = [1, 79], $V_ = [1, 71], $V$ = [1, 72], $V01 = [1, 74], $V11 = [1, 75], $V21 = [1, 83], $V31 = [1, 87], $V41 = [1, 86], $V51 = [1, 84], $V61 = [1, 95], $V71 = [1, 109], $V81 = [48, 105], $V91 = [2, 201], $Va1 = [1, 113], $Vb1 = [2, 1], $Vc1 = [1, 9, 12, 13, 19, 20, 22, 24, 25, 26, 30, 32, 33, 34, 35, 37, 46, 47, 48, 56, 57, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 79, 81, 82, 96, 102, 103, 104, 105], $Vd1 = [2, 2], $Ve1 = [19, 46, 47, 48], $Vf1 = [1, 120], $Vg1 = [1, 119], $Vh1 = [22, 46, 47], $Vi1 = [2, 156], $Vj1 = [1, 130], $Vk1 = [1, 125], $Vl1 = [1, 128], $Vm1 = [1, 129], $Vn1 = [25, 47], $Vo1 = [1, 9, 12, 13, 19, 20, 22, 24, 25, 26, 30, 32, 33, 34, 35, 37, 46, 47, 48, 56, 57, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 79, 81, 82, 96, 99, 102, 103, 104, 105], $Vp1 = [30, 47, 48], $Vq1 = [2, 58], $Vr1 = [1, 169], $Vs1 = [12, 19, 20, 30, 46, 47, 48], $Vt1 = [2, 55], $Vu1 = [2, 71], $Vv1 = [12, 46, 47, 48], $Vw1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 58, 59, 62, 63, 64, 66, 67, 68, 70, 71, 72, 79, 81, 82, 102, 105], $Vx1 = [20, 46, 47, 48], $Vy1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 79, 81, 82, 102, 105], $Vz1 = [1, 206], $VA1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 33, 34, 35, 46, 47, 48, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 79, 81, 102, 105], $VB1 = [1, 209], $VC1 = [46, 48, 82], $VD1 = [2, 203], $VE1 = [1, 215], $VF1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 71, 72, 79, 81, 82, 102, 105], $VG1 = [19, 47, 48], $VH1 = [1, 227], $VI1 = [20, 22, 46, 47], $VJ1 = [9, 13, 20, 22, 32, 33, 37, 46, 47, 56, 57, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 79, 96], $VK1 = [2, 165], $VL1 = [1, 251], $VM1 = [19, 20, 22, 47, 48, 81, 102], $VN1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 58, 62, 63, 66, 67, 68, 70, 71, 72, 79, 81, 82, 102, 105], $VO1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 63, 67, 71, 72, 79, 81, 82, 102, 105], $VP1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 62, 63, 67, 70, 71, 72, 79, 81, 82, 102, 105], $VQ1 = [1, 264], $VR1 = [1, 265], $VS1 = [2, 59], $VT1 = [12, 47, 48], $VU1 = [20, 47, 48], $VV1 = [1, 302], $VW1 = [1, 303], $VX1 = [1, 311], $VY1 = [4, 7, 14, 16, 21, 23, 29, 31, 32, 38, 41, 44, 48, 49, 59, 60, 61, 75, 76, 77, 78, 80, 81, 83, 84, 85, 90, 93, 97, 102], $VZ1 = [1, 336], $V_1 = [1, 337], $V$1 = [1, 12, 19, 20, 22, 24, 25, 26, 30, 33, 34, 35, 46, 47, 48, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 79, 81, 82, 88, 89, 102, 105], $V02 = [2, 46], $V12 = [1, 369];
        var parser2 = {
          trace: function trace() {
          },
          yy: {},
          symbols_: { "error": 2, "Chain": 3, "ID": 4, "KeyLike": 5, "List": 6, "LITERAL": 7, "Index": 8, "CALL(": 9, "ArgList": 10, "OptComma": 11, ")CALL": 12, "?": 13, "LET": 14, "Block": 15, "[": 16, "Expression": 17, "LoopHeads": 18, "]": 19, "DEDENT": 20, "{": 21, "}": 22, "(": 23, "BIOP": 24, ")": 25, "BIOPR": 26, "BIOPBP": 27, "BIOPP": 28, "PARAM(": 29, ")PARAM": 30, "UNARY": 31, "CREMENT": 32, "BACKTICK": 33, "TO": 34, "BY": 35, "FROM": 36, "DOT": 37, "WITH": 38, "LoopHead": 39, "Else": 40, "STRNUM": 41, "Parenthetical": 42, "Properties": 43, "LABEL": 44, "Arg": 45, ",": 46, "NEWLINE": 47, "INDENT": 48, "...": 49, "Lines": 50, "Line": 51, "<-": 52, "COMMENT": 53, "REQUIRE": 54, "SplatChain": 55, "CLONEPORT": 56, "ASSIGN": 57, "IMPORT": 58, "+-": 59, "CLONE": 60, "YIELD": 61, "COMPARE": 62, "LOGIC": 63, "MATH": 64, "POWER": 65, "SHIFT": 66, "BITWISE": 67, "CONCAT": 68, "COMPOSE": 69, "RELATION": 70, "PIPE": 71, "BACKPIPE": 72, "!?": 73, "->": 74, "FUNCTION": 75, "GENERATOR": 76, "ASYNC": 77, "IF": 78, "POST_IF": 79, "DO": 80, "WHILE": 81, "CASE": 82, "HURL": 83, "JUMP": 84, "SWITCH": 85, "Exprs": 86, "Cases": 87, "DEFAULT": 88, "ELSE": 89, "TRY": 90, "CATCH": 91, "FINALLY": 92, "CLASS": 93, "OptExtends": 94, "OptImplements": 95, "EXTENDS": 96, "DECL": 97, "KeyColon": 98, ":": 99, "Property": 100, "Body": 101, "FOR": 102, "IN": 103, "OF": 104, "IMPLEMENTS": 105, "Root": 106, "$accept": 0, "$end": 1 },
          terminals_: { 2: "error", 4: "ID", 7: "LITERAL", 9: "CALL(", 12: ")CALL", 13: "?", 14: "LET", 16: "[", 19: "]", 20: "DEDENT", 21: "{", 22: "}", 23: "(", 24: "BIOP", 25: ")", 26: "BIOPR", 27: "BIOPBP", 28: "BIOPP", 29: "PARAM(", 30: ")PARAM", 31: "UNARY", 32: "CREMENT", 33: "BACKTICK", 34: "TO", 35: "BY", 36: "FROM", 37: "DOT", 38: "WITH", 41: "STRNUM", 44: "LABEL", 46: ",", 47: "NEWLINE", 48: "INDENT", 49: "...", 52: "<-", 53: "COMMENT", 54: "REQUIRE", 56: "CLONEPORT", 57: "ASSIGN", 58: "IMPORT", 59: "+-", 60: "CLONE", 61: "YIELD", 62: "COMPARE", 63: "LOGIC", 64: "MATH", 65: "POWER", 66: "SHIFT", 67: "BITWISE", 68: "CONCAT", 69: "COMPOSE", 70: "RELATION", 71: "PIPE", 72: "BACKPIPE", 73: "!?", 74: "->", 75: "FUNCTION", 76: "GENERATOR", 77: "ASYNC", 78: "IF", 79: "POST_IF", 80: "DO", 81: "WHILE", 82: "CASE", 83: "HURL", 84: "JUMP", 85: "SWITCH", 88: "DEFAULT", 89: "ELSE", 90: "TRY", 91: "CATCH", 92: "FINALLY", 93: "CLASS", 96: "EXTENDS", 97: "DECL", 99: ":", 102: "FOR", 103: "IN", 104: "OF", 105: "IMPLEMENTS" },
          productions_: [0, [3, 1], [3, 1], [3, 1], [3, 1], [3, 2], [3, 5], [3, 2], [3, 6], [3, 4], [3, 5], [3, 7], [3, 3], [3, 4], [3, 4], [3, 3], [3, 4], [3, 4], [3, 3], [3, 7], [3, 3], [3, 7], [3, 3], [3, 3], [3, 5], [3, 6], [3, 6], [3, 5], [3, 7], [3, 6], [3, 8], [3, 4], [3, 6], [3, 9], [3, 8], [3, 7], [3, 6], [3, 6], [3, 5], [3, 3], [3, 3], [5, 1], [5, 1], [8, 2], [8, 2], [8, 2], [6, 4], [6, 4], [6, 5], [6, 5], [10, 0], [10, 1], [10, 3], [10, 4], [10, 6], [45, 1], [45, 2], [45, 1], [11, 0], [11, 1], [50, 0], [50, 1], [50, 3], [50, 2], [51, 1], [51, 2], [51, 6], [51, 1], [51, 1], [51, 2], [15, 3], [55, 2], [17, 3], [17, 3], [17, 5], [17, 1], [17, 3], [17, 3], [17, 6], [17, 3], [17, 6], [17, 2], [17, 2], [17, 3], [17, 2], [17, 3], [17, 3], [17, 3], [17, 4], [17, 4], [17, 4], [17, 2], [17, 2], [17, 2], [17, 3], [17, 3], [17, 3], [17, 6], [17, 5], [17, 1], [17, 2], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 3], [17, 2], [17, 6], [17, 6], [17, 6], [17, 7], [17, 7], [17, 4], [17, 3], [17, 4], [17, 6], [17, 2], [17, 5], [17, 1], [17, 1], [17, 2], [17, 3], [17, 5], [17, 5], [17, 2], [17, 4], [17, 4], [17, 2], [17, 2], [17, 4], [17, 6], [17, 5], [17, 7], [17, 4], [17, 5], [17, 4], [17, 3], [17, 2], [17, 2], [17, 5], [86, 1], [86, 3], [98, 2], [98, 2], [100, 2], [100, 5], [100, 1], [100, 2], [100, 1], [43, 0], [43, 1], [43, 3], [43, 4], [43, 4], [42, 3], [101, 1], [101, 1], [101, 3], [40, 0], [40, 2], [40, 5], [39, 4], [39, 6], [39, 6], [39, 8], [39, 2], [39, 4], [39, 4], [39, 6], [39, 4], [39, 6], [39, 6], [39, 8], [39, 6], [39, 5], [39, 8], [39, 7], [39, 8], [39, 7], [39, 10], [39, 9], [39, 10], [39, 9], [39, 2], [39, 4], [39, 4], [39, 6], [18, 1], [18, 2], [18, 3], [18, 3], [87, 3], [87, 4], [94, 2], [94, 0], [95, 2], [95, 0], [106, 1]],
          performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
            var $0 = $$.length - 1;
            switch (yystate) {
              case 1:
                this.$ = yy.L(_$[$0], _$[$0], yy.Chain(yy.L(_$[$0], _$[$0], yy.Var($$[$0]))));
                break;
              case 2:
              case 3:
                this.$ = yy.L(_$[$0], _$[$0], yy.Chain($$[$0]));
                break;
              case 4:
                this.$ = yy.L(_$[$0], _$[$0], yy.Chain(yy.L(_$[$0], _$[$0], yy.Literal($$[$0]))));
                break;
              case 5:
                this.$ = yy.L(_$[$0 - 1], _$[$0], $$[$0 - 1].add($$[$0]));
                break;
              case 6:
                this.$ = yy.L(_$[$0 - 4], _$[$0], $$[$0 - 4].add(yy.L(_$[$0 - 3], _$[$0], yy.Call($$[$0 - 2]))));
                break;
              case 7:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Chain(yy.L(_$[$0 - 1], _$[$0], yy.Existence($$[$0 - 1].unwrap()))));
                break;
              case 8:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Chain(yy.L(_$[$0 - 5], _$[$0 - 1], yy.Call["let"]($$[$0 - 3], $$[$0]))));
                break;
              case 9:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Chain(yy.L(_$[$0 - 3], _$[$0], $$[$0 - 1][0].makeComprehension($$[$0 - 2], $$[$0 - 1].slice(1)))));
                break;
              case 10:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Chain(yy.L(_$[$0 - 4], _$[$0], $$[$0 - 2][0].makeComprehension($$[$0 - 3], $$[$0 - 2].slice(1)))));
                break;
              case 11:
                this.$ = yy.L(_$[$0 - 6], _$[$0], yy.Chain(yy.L(_$[$0 - 6], _$[$0], $$[$0 - 1][0].addObjComp().makeComprehension(yy.L(_$[$0 - 4], _$[$0 - 4], yy.Arr($$[$0 - 4])), $$[$0 - 1].slice(1)))));
                break;
              case 12:
              case 18:
              case 20:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Chain(yy.L(_$[$0 - 1], _$[$0 - 1], yy.Binary($$[$0 - 1]))));
                break;
              case 13:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Chain(yy.L(_$[$0 - 2], _$[$0 - 2], yy.Binary($$[$0 - 2], void 0, $$[$0 - 1]))));
                break;
              case 14:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Chain(yy.L(_$[$0 - 1], _$[$0 - 1], yy.Binary($$[$0 - 1], $$[$0 - 2]))));
                break;
              case 15:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Chain(yy.L(_$[$0 - 1], _$[$0 - 1], "!" === $$[$0 - 1].charAt(0) ? yy.Binary($$[$0 - 1].slice(1)).invertIt() : yy.Binary($$[$0 - 1]))));
                break;
              case 16:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Chain(yy.L(_$[$0 - 2], _$[$0 - 2], "!" === $$[$0 - 2].charAt(0) ? yy.Binary($$[$0 - 2].slice(1), void 0, $$[$0 - 1]).invertIt() : yy.Binary($$[$0 - 2], void 0, $$[$0 - 1]))));
                break;
              case 17:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Chain(yy.L(_$[$0 - 1], _$[$0 - 1], "!" === $$[$0 - 1].charAt(0) ? yy.Binary($$[$0 - 1].slice(1), $$[$0 - 2]).invertIt() : yy.Binary($$[$0 - 1], $$[$0 - 2]))));
                break;
              case 19:
                this.$ = yy.L(_$[$0 - 6], _$[$0], yy.Chain(yy.L(_$[$0 - 5], _$[$0 - 5], yy.Binary($$[$0 - 5], void 0, $$[$0 - 3]))));
                break;
              case 21:
                this.$ = yy.L(_$[$0 - 6], _$[$0], yy.Chain(yy.L(_$[$0 - 1], _$[$0 - 1], yy.Binary($$[$0 - 1], $$[$0 - 4]))));
                break;
              case 22:
              case 23:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Chain(yy.L(_$[$0 - 1], _$[$0 - 1], yy.Unary($$[$0 - 1]))));
                break;
              case 24:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Chain($$[$0 - 2]));
                break;
              case 25:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Chain(yy.L(_$[$0 - 4], _$[$0 - 1], $$[$0 - 2].add(yy.L(_$[$0 - 4], _$[$0 - 4], yy.Call([$$[$0 - 4]]))))));
                break;
              case 26:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Chain(yy.L(_$[$0 - 3], _$[$0 - 3], yy.Chain(yy.Var("flip$"))).add(yy.L(_$[$0 - 3], _$[$0 - 3], yy.Call([$$[$0 - 3]])))).flipIt().add(yy.L(_$[$0 - 1], _$[$0 - 1], yy.Call([$$[$0 - 1]]))));
                break;
              case 27:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Chain(yy.L(_$[$0 - 3], _$[$0 - 1], new yy.For({
                  from: $$[$0 - 3],
                  op: $$[$0 - 2],
                  to: $$[$0 - 1],
                  inComprehension: true
                }))));
                break;
              case 28:
                this.$ = yy.L(_$[$0 - 6], _$[$0], yy.Chain(yy.L(_$[$0 - 5], _$[$0 - 1], new yy.For({
                  from: $$[$0 - 5],
                  op: $$[$0 - 4],
                  to: $$[$0 - 3],
                  step: $$[$0 - 1],
                  inComprehension: true
                }))));
                break;
              case 29:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Chain(yy.L(_$[$0 - 4], _$[$0 - 1], new yy.For({
                  from: $$[$0 - 3],
                  op: $$[$0 - 2],
                  to: $$[$0 - 1],
                  inComprehension: true
                }))));
                break;
              case 30:
                this.$ = yy.L(_$[$0 - 7], _$[$0], yy.Chain(yy.L(_$[$0 - 6], _$[$0 - 1], new yy.For({
                  from: $$[$0 - 5],
                  op: $$[$0 - 4],
                  to: $$[$0 - 3],
                  step: $$[$0 - 1],
                  inComprehension: true
                }))));
                break;
              case 31:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Chain(yy.L(_$[$0 - 2], _$[$0 - 1], new yy.For({
                  from: yy.Chain(yy.Literal(0)),
                  op: $$[$0 - 2],
                  to: $$[$0 - 1],
                  inComprehension: true
                }))));
                break;
              case 32:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Chain(yy.L(_$[$0 - 4], _$[$0 - 1], new yy.For({
                  from: yy.Chain(yy.Literal(0)),
                  op: $$[$0 - 4],
                  to: $$[$0 - 3],
                  step: $$[$0 - 1],
                  inComprehension: true
                }))));
                break;
              case 33:
                this.$ = yy.L(_$[$0 - 8], _$[$0], yy.Chain(yy.L(_$[$0 - 8], _$[$0], new yy.StepSlice({
                  op: $$[$0 - 4],
                  target: $$[$0 - 8],
                  from: $$[$0 - 5],
                  to: $$[$0 - 3],
                  step: $$[$0 - 1]
                }))));
                break;
              case 34:
                this.$ = yy.L(_$[$0 - 7], _$[$0], yy.Chain(yy.L(_$[$0 - 7], _$[$0], new yy.StepSlice({
                  op: $$[$0 - 4],
                  target: $$[$0 - 7],
                  from: yy.Literal(0),
                  to: $$[$0 - 3],
                  step: $$[$0 - 1]
                }))));
                break;
              case 35:
                this.$ = yy.L(_$[$0 - 6], _$[$0], yy.Chain(yy.L(_$[$0 - 6], _$[$0], yy.Slice({
                  type: $$[$0 - 2],
                  target: $$[$0 - 6],
                  from: $$[$0 - 3],
                  to: $$[$0 - 1]
                }))));
                break;
              case 36:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Chain(yy.L(_$[$0 - 5], _$[$0], yy.Slice({
                  type: $$[$0 - 1],
                  target: $$[$0 - 5],
                  from: $$[$0 - 2]
                }))));
                break;
              case 37:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Chain(yy.L(_$[$0 - 5], _$[$0], yy.Slice({
                  type: $$[$0 - 2],
                  target: $$[$0 - 5],
                  to: $$[$0 - 1]
                }))));
                break;
              case 38:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Chain(yy.L(_$[$0 - 4], _$[$0], yy.Slice({
                  type: $$[$0 - 1],
                  target: $$[$0 - 4]
                }))));
                break;
              case 39:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Chain(yy.L(_$[$0 - 2], _$[$0 - 1], yy.Cascade($$[$0 - 1], $$[$0], "with"))));
                break;
              case 40:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Chain($$[$0 - 2].addBody($$[$0 - 1]).addElse($$[$0])));
                break;
              case 41:
                this.$ = yy.L(_$[$0], _$[$0], yy.Literal($$[$0]));
                break;
              case 42:
              case 55:
              case 58:
              case 59:
              case 63:
              case 64:
              case 162:
              case 163:
                break;
              case 43:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Index(yy.L(_$[$0], _$[$0], yy.Key($$[$0])), $$[$0 - 1], true));
                break;
              case 44:
              case 45:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Index($$[$0], $$[$0 - 1], true));
                break;
              case 46:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Arr($$[$0 - 2]));
                break;
              case 47:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Obj($$[$0 - 2]));
                break;
              case 48:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Arr($$[$0 - 3]).named($$[$0]));
                break;
              case 49:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Obj($$[$0 - 3]).named($$[$0]));
                break;
              case 50:
              case 156:
                this.$ = yy.L(_$[$0], _$[$0], []);
                break;
              case 51:
              case 147:
              case 157:
              case 194:
                this.$ = yy.L(_$[$0], _$[$0], [$$[$0]]);
                break;
              case 52:
              case 148:
              case 158:
              case 196:
              case 197:
                this.$ = yy.L(_$[$0 - 2], _$[$0], $$[$0 - 2].concat($$[$0]));
                break;
              case 53:
              case 159:
                this.$ = yy.L(_$[$0 - 3], _$[$0], $$[$0 - 3].concat($$[$0]));
                break;
              case 54:
                this.$ = yy.L(_$[$0 - 5], _$[$0 - 2], $$[$0 - 5].concat($$[$0 - 2]));
                break;
              case 56:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Splat($$[$0]));
                break;
              case 57:
                this.$ = yy.L(_$[$0], _$[$0], yy.Splat(yy.L(_$[$0], _$[$0], yy.Arr()), true));
                break;
              case 60:
                this.$ = yy.L(_$[$0], _$[$0], yy.Block());
                break;
              case 61:
                this.$ = yy.L(_$[$0], _$[$0], yy.Block($$[$0]));
                break;
              case 62:
              case 164:
                this.$ = yy.L(_$[$0 - 2], _$[$0], $$[$0 - 2].add($$[$0]));
                break;
              case 65:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Cascade($$[$0 - 1], $$[$0], "cascade"));
                break;
              case 66:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Call.back($$[$0 - 4], $$[$0], /~/.test($$[$0 - 1]), /--|~~/.test($$[$0 - 1]), /!/.test($$[$0 - 1]), /\*/.test($$[$0 - 1])));
                break;
              case 67:
              case 155:
                this.$ = yy.L(_$[$0], _$[$0], yy.JS($$[$0], true, true));
                break;
              case 68:
                this.$ = yy.L(_$[$0], _$[$0], yy.Throw(yy.L(_$[$0], _$[$0], yy.JS("Error('unimplemented')"))));
                break;
              case 69:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Require($$[$0].unwrap()));
                break;
              case 70:
                this.$ = yy.L(_$[$0 - 2], _$[$0], $$[$0 - 1]);
                break;
              case 71:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Splat($$[$0].unwrap()));
                break;
              case 72:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Import(yy.L(_$[$0 - 2], _$[$0 - 1], yy.Unary("^^", $$[$0 - 2], {
                  prec: "yy.UNARY"
                })), $$[$0], false));
                break;
              case 73:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Import(yy.L(_$[$0 - 2], _$[$0 - 1], yy.Unary("^^", $$[$0 - 2], {
                  prec: "yy.UNARY"
                })), $$[$0].unwrap(), false));
                break;
              case 74:
                this.$ = yy.L(_$[$0 - 4], _$[$0], $$[$0 - 2].add(yy.L(_$[$0 - 4], _$[$0], yy.Call([$$[$0 - 4], $$[$0]]))));
                break;
              case 75:
                this.$ = yy.L(_$[$0], _$[$0], $$[$0].unwrap());
                break;
              case 76:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Assign($$[$0 - 2].unwrap(), $$[$0], yy.L(_$[$0 - 1], _$[$0 - 1], yy.Box($$[$0 - 1]))));
                break;
              case 77:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Assign($$[$0 - 2], $$[$0], yy.L(_$[$0 - 1], _$[$0 - 1], yy.Box($$[$0 - 1]))));
                break;
              case 78:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Assign($$[$0 - 5].unwrap(), yy.Arr.maybe($$[$0 - 2]), yy.L(_$[$0 - 4], _$[$0 - 4], yy.Box($$[$0 - 4]))));
                break;
              case 79:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Import($$[$0 - 2], $$[$0], $$[$0 - 1] === "<<<<"));
                break;
              case 80:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Import($$[$0 - 5], yy.Arr.maybe($$[$0 - 2]), $$[$0 - 4] === "<<<<"));
                break;
              case 81:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Unary($$[$0 - 1], $$[$0].unwrap()));
                break;
              case 82:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Unary($$[$0], $$[$0 - 1].unwrap(), true));
                break;
              case 83:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Unary($$[$0 - 2], yy.Splat($$[$0].unwrap())));
                break;
              case 84:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Unary($$[$0], $$[$0 - 1], true));
                break;
              case 85:
              case 86:
              case 87:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Assign($$[$0].unwrap(), [$$[$0 - 2]], yy.L(_$[$0 - 1], _$[$0 - 1], yy.Box($$[$0 - 1]))));
                break;
              case 88:
              case 89:
              case 90:
                this.$ = yy.L(_$[$0 - 3], _$[$0], yy.Assign(yy.Splat($$[$0].unwrap()), [$$[$0 - 3]], yy.L(_$[$0 - 2], _$[$0 - 2], yy.Box($$[$0 - 2]))));
                break;
              case 91:
              case 92:
              case 93:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Unary($$[$0 - 1], $$[$0]));
                break;
              case 94:
              case 95:
              case 96:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Unary($$[$0 - 2], yy.Splat($$[$0])));
                break;
              case 97:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Unary($$[$0 - 5], yy.Splat(yy.Arr($$[$0 - 2]))));
                break;
              case 98:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Unary($$[$0 - 4], yy.Arr.maybe($$[$0 - 2])));
                break;
              case 99:
                this.$ = yy.L(_$[$0], _$[$0], yy.Yield($$[$0]));
                break;
              case 100:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Yield($$[$0 - 1], $$[$0]));
                break;
              case 101:
              case 102:
              case 103:
              case 104:
              case 105:
              case 106:
              case 107:
              case 108:
              case 109:
                this.$ = yy.L(_$[$0 - 1], _$[$0 - 1], yy.Binary($$[$0 - 1], $$[$0 - 2], $$[$0]));
                break;
              case 110:
                this.$ = yy.L(_$[$0 - 2], _$[$0], "!" === $$[$0 - 1].charAt(0) ? yy.Binary($$[$0 - 1].slice(1), $$[$0 - 2], $$[$0]).invert() : yy.Binary($$[$0 - 1], $$[$0 - 2], $$[$0]));
                break;
              case 111:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Block($$[$0 - 2]).pipe($$[$0], $$[$0 - 1]));
                break;
              case 112:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Block($$[$0 - 2]).pipe([$$[$0]], $$[$0 - 1]));
                break;
              case 113:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Existence($$[$0 - 1].unwrap(), true));
                break;
              case 114:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Fun($$[$0 - 4], $$[$0], /~/.test($$[$0 - 1]), /--|~~/.test($$[$0 - 1]), /!/.test($$[$0 - 1]), /\*/.test($$[$0 - 1]), />>/.test($$[$0 - 1])));
                break;
              case 115:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Fun($$[$0 - 3], $$[$0]).named($$[$0 - 5]));
                break;
              case 116:
                this.$ = yy.L(_$[$0 - 5], _$[$0], yy.Fun($$[$0 - 3], $$[$0], false, false, false, true, false).named($$[$0 - 5]));
                break;
              case 117:
                this.$ = yy.L(_$[$0 - 6], _$[$0], yy.Fun($$[$0 - 3], $$[$0], false, false, false, false, true).named($$[$0 - 5]));
                break;
              case 118:
                this.$ = yy.L(_$[$0 - 6], _$[$0], yy.Fun($$[$0 - 3], $$[$0], false, false, false, true, true).named($$[$0 - 5]));
                break;
              case 119:
                this.$ = yy.L(_$[$0 - 3], _$[$0 - 2], yy.If($$[$0 - 2], $$[$0 - 1], $$[$0 - 3] === "unless")).addElse($$[$0]);
                break;
              case 120:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.If($$[$0], $$[$0 - 2], $$[$0 - 1] === "unless"));
                break;
              case 121:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.While($$[$0], $$[$0 - 1] === "until", true).addBody($$[$0 - 2]));
                break;
              case 122:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.While($$[$0 - 2], $$[$0 - 3] === "until", true).addGuard($$[$0]).addBody($$[$0 - 4]));
                break;
              case 123:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Jump[$$[$0 - 1]]($$[$0]));
                break;
              case 124:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Jump[$$[$0 - 4]](yy.Arr.maybe($$[$0 - 2])));
                break;
              case 125:
                this.$ = yy.L(_$[$0], _$[$0], yy.Jump[$$[$0]]());
                break;
              case 126:
                this.$ = yy.L(_$[$0], _$[$0], new yy.Jump($$[$0]));
                break;
              case 127:
                this.$ = yy.L(_$[$0 - 1], _$[$0], new yy.Jump($$[$0 - 1], $$[$0]));
                break;
              case 128:
                this.$ = yy.L(_$[$0 - 2], _$[$0], new yy.Switch($$[$0 - 2], $$[$0 - 1], $$[$0]));
                break;
              case 129:
              case 130:
                this.$ = yy.L(_$[$0 - 4], _$[$0], new yy.Switch($$[$0 - 4], $$[$0 - 3], $$[$0 - 2], $$[$0]));
                break;
              case 131:
                this.$ = yy.L(_$[$0 - 1], _$[$0], new yy.Switch($$[$0 - 1], null, $$[$0]));
                break;
              case 132:
              case 133:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.Switch($$[$0 - 3], null, $$[$0 - 2], $$[$0]));
                break;
              case 134:
                this.$ = yy.L(_$[$0 - 1], _$[$0], new yy.Switch($$[$0 - 1], null, [], $$[$0]));
                break;
              case 135:
                this.$ = yy.L(_$[$0 - 1], _$[$0], new yy.Try($$[$0]));
                break;
              case 136:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.Try($$[$0 - 2], void 0, yy.L(_$[$0 - 1], _$[$0 - 1], $$[$0])));
                break;
              case 137:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.Try($$[$0 - 4], void 0, yy.L(_$[$0 - 3], _$[$0 - 3], $$[$0 - 2]), yy.L(_$[$0 - 1], _$[$0 - 1], $$[$0])));
                break;
              case 138:
                this.$ = yy.L(_$[$0 - 4], _$[$0], new yy.Try($$[$0 - 3], $$[$0 - 1], yy.L(_$[$0 - 2], _$[$0 - 1], $$[$0])));
                break;
              case 139:
                this.$ = yy.L(_$[$0 - 6], _$[$0], new yy.Try($$[$0 - 5], $$[$0 - 3], yy.L(_$[$0 - 4], _$[$0 - 3], $$[$0 - 2]), yy.L(_$[$0 - 1], _$[$0 - 1], $$[$0])));
                break;
              case 140:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.Try($$[$0 - 2], void 0, void 0, yy.L(_$[$0 - 1], _$[$0 - 1], $$[$0])));
                break;
              case 141:
                this.$ = yy.L(_$[$0 - 4], _$[$0], new yy.Class({
                  title: $$[$0 - 3].unwrap(),
                  sup: $$[$0 - 2],
                  mixins: $$[$0 - 1],
                  body: $$[$0]
                }));
                break;
              case 142:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.Class({
                  sup: $$[$0 - 2],
                  mixins: $$[$0 - 1],
                  body: $$[$0]
                }));
                break;
              case 143:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Util.Extends($$[$0 - 2].unwrap(), $$[$0]));
                break;
              case 144:
              case 145:
                this.$ = yy.L(_$[$0 - 1], _$[$0], new yy.Label($$[$0 - 1], $$[$0]));
                break;
              case 146:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Decl($$[$0 - 4], $$[$0 - 2], yylineno + 1));
                break;
              case 149:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Key($$[$0 - 1]));
                break;
              case 150:
                this.$ = yy.L(_$[$0 - 1], _$[$0], $$[$0 - 1]);
                break;
              case 151:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Prop($$[$0 - 1], $$[$0]));
                break;
              case 152:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.Prop($$[$0 - 4], yy.Arr.maybe($$[$0 - 2])));
                break;
              case 153:
                this.$ = yy.L(_$[$0], _$[$0], yy.Prop(null, $$[$0]));
                break;
              case 154:
                this.$ = yy.L(_$[$0 - 1], _$[$0], yy.Prop(yy.Splat(), $$[$0]));
                break;
              case 160:
                this.$ = yy.L(_$[$0 - 3], _$[$0], $$[$0 - 2]);
                break;
              case 161:
                this.$ = yy.L(_$[$0 - 2], _$[$0], yy.Parens($$[$0 - 1].chomp().unwrap(), false, $$[$0 - 2] === '"', yy.L(_$[$0 - 2], _$[$0 - 2], {}), yy.L(_$[$0], _$[$0], {})));
                break;
              case 165:
              case 201:
              case 203:
                this.$ = yy.L(_$[$0], _$[$0], null);
                break;
              case 166:
              case 200:
              case 202:
                this.$ = yy.L(_$[$0 - 1], _$[$0], $$[$0]);
                break;
              case 167:
                this.$ = yy.L(_$[$0 - 4], _$[$0], yy.If($$[$0 - 2], $$[$0 - 1], $$[$0 - 3] === "unless").addElse($$[$0]));
                break;
              case 168:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.For({
                  kind: $$[$0 - 3],
                  item: $$[$0 - 2].unwrap(),
                  index: $$[$0 - 1],
                  source: $$[$0]
                }));
                break;
              case 169:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.For({
                  kind: $$[$0 - 5],
                  item: $$[$0 - 4].unwrap(),
                  index: $$[$0 - 3],
                  source: $$[$0 - 2],
                  guard: $$[$0]
                }));
                break;
              case 170:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.For({
                  kind: $$[$0 - 5],
                  item: $$[$0 - 4].unwrap(),
                  index: $$[$0 - 3],
                  source: $$[$0 - 2],
                  step: $$[$0]
                }));
                break;
              case 171:
                this.$ = yy.L(_$[$0 - 7], _$[$0], new yy.For({
                  kind: $$[$0 - 7],
                  item: $$[$0 - 6].unwrap(),
                  index: $$[$0 - 5],
                  source: $$[$0 - 4],
                  step: $$[$0 - 2],
                  guard: $$[$0]
                }));
                break;
              case 172:
                this.$ = yy.L(_$[$0 - 1], _$[$0], new yy.For({
                  kind: $$[$0 - 1],
                  source: $$[$0],
                  ref: true
                }));
                break;
              case 173:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.For({
                  kind: $$[$0 - 3],
                  source: $$[$0 - 2],
                  ref: true,
                  guard: $$[$0]
                }));
                break;
              case 174:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.For({
                  kind: $$[$0 - 3],
                  source: $$[$0 - 2],
                  ref: true,
                  step: $$[$0]
                }));
                break;
              case 175:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.For({
                  kind: $$[$0 - 5],
                  source: $$[$0 - 4],
                  ref: true,
                  step: $$[$0 - 2],
                  guard: $$[$0]
                }));
                break;
              case 176:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.For({
                  object: true,
                  kind: $$[$0 - 3],
                  index: $$[$0 - 2],
                  source: $$[$0]
                }));
                break;
              case 177:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.For({
                  object: true,
                  kind: $$[$0 - 5],
                  index: $$[$0 - 4],
                  source: $$[$0 - 2],
                  guard: $$[$0]
                }));
                break;
              case 178:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.For({
                  object: true,
                  kind: $$[$0 - 5],
                  index: $$[$0 - 4],
                  item: $$[$0 - 2].unwrap(),
                  source: $$[$0]
                }));
                break;
              case 179:
                this.$ = yy.L(_$[$0 - 7], _$[$0], new yy.For({
                  object: true,
                  kind: $$[$0 - 7],
                  index: $$[$0 - 6],
                  item: $$[$0 - 4].unwrap(),
                  source: $$[$0 - 2],
                  guard: $$[$0]
                }));
                break;
              case 180:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.For({
                  kind: $$[$0 - 5],
                  index: $$[$0 - 4],
                  from: $$[$0 - 2],
                  op: $$[$0 - 1],
                  to: $$[$0]
                }));
                break;
              case 181:
                this.$ = yy.L(_$[$0 - 4], _$[$0], new yy.For({
                  kind: $$[$0 - 4],
                  from: $$[$0 - 2],
                  op: $$[$0 - 1],
                  to: $$[$0],
                  ref: true
                }));
                break;
              case 182:
                this.$ = yy.L(_$[$0 - 7], _$[$0], new yy.For({
                  kind: $$[$0 - 7],
                  index: $$[$0 - 6],
                  from: $$[$0 - 4],
                  op: $$[$0 - 3],
                  to: $$[$0 - 2],
                  guard: $$[$0]
                }));
                break;
              case 183:
                this.$ = yy.L(_$[$0 - 6], _$[$0], new yy.For({
                  kind: $$[$0 - 6],
                  from: $$[$0 - 4],
                  op: $$[$0 - 3],
                  to: $$[$0 - 2],
                  guard: $$[$0],
                  ref: true
                }));
                break;
              case 184:
                this.$ = yy.L(_$[$0 - 7], _$[$0], new yy.For({
                  kind: $$[$0 - 7],
                  index: $$[$0 - 6],
                  from: $$[$0 - 4],
                  op: $$[$0 - 3],
                  to: $$[$0 - 2],
                  step: $$[$0]
                }));
                break;
              case 185:
                this.$ = yy.L(_$[$0 - 6], _$[$0], new yy.For({
                  kind: $$[$0 - 6],
                  from: $$[$0 - 4],
                  op: $$[$0 - 3],
                  to: $$[$0 - 2],
                  step: $$[$0],
                  ref: true
                }));
                break;
              case 186:
                this.$ = yy.L(_$[$0 - 9], _$[$0], new yy.For({
                  kind: $$[$0 - 9],
                  index: $$[$0 - 8],
                  from: $$[$0 - 6],
                  op: $$[$0 - 5],
                  to: $$[$0 - 4],
                  step: $$[$0 - 2],
                  guard: $$[$0]
                }));
                break;
              case 187:
                this.$ = yy.L(_$[$0 - 8], _$[$0], new yy.For({
                  kind: $$[$0 - 8],
                  from: $$[$0 - 6],
                  op: $$[$0 - 5],
                  to: $$[$0 - 4],
                  step: $$[$0 - 2],
                  guard: $$[$0],
                  ref: true
                }));
                break;
              case 188:
                this.$ = yy.L(_$[$0 - 9], _$[$0], new yy.For({
                  kind: $$[$0 - 9],
                  index: $$[$0 - 8],
                  from: $$[$0 - 6],
                  op: $$[$0 - 5],
                  to: $$[$0 - 4],
                  guard: $$[$0 - 2],
                  step: $$[$0]
                }));
                break;
              case 189:
                this.$ = yy.L(_$[$0 - 8], _$[$0], new yy.For({
                  kind: $$[$0 - 8],
                  from: $$[$0 - 6],
                  op: $$[$0 - 5],
                  to: $$[$0 - 4],
                  guard: $$[$0 - 2],
                  step: $$[$0],
                  ref: true
                }));
                break;
              case 190:
                this.$ = yy.L(_$[$0 - 1], _$[$0], new yy.While($$[$0], $$[$0 - 1] === "until"));
                break;
              case 191:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.While($$[$0 - 2], $$[$0 - 3] === "until").addGuard($$[$0]));
                break;
              case 192:
                this.$ = yy.L(_$[$0 - 3], _$[$0], new yy.While($$[$0 - 2], $$[$0 - 3] === "until", $$[$0]));
                break;
              case 193:
                this.$ = yy.L(_$[$0 - 5], _$[$0], new yy.While($$[$0 - 4], $$[$0 - 5] === "until", $$[$0 - 2]).addGuard($$[$0]));
                break;
              case 195:
                this.$ = yy.L(_$[$0 - 1], _$[$0], $$[$0 - 1].concat($$[$0]));
                break;
              case 198:
                this.$ = yy.L(_$[$0 - 2], _$[$0], [yy.L(_$[$0 - 2], _$[$0 - 1], new yy.Case($$[$0 - 1], $$[$0]))]);
                break;
              case 199:
                this.$ = yy.L(_$[$0 - 3], _$[$0], $$[$0 - 3].concat(yy.L(_$[$0 - 2], _$[$0 - 1], new yy.Case($$[$0 - 1], $$[$0]))));
                break;
              case 204:
                return this.$;
                break;
            }
          },
          table: [o([1, 47], $V0, { 106: 1, 101: 2, 50: 3, 15: 4, 51: 5, 17: 7, 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $V7, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 48: $Vd, 49: $Ve, 53: $Vf, 54: $Vg, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 1: [3] }, { 1: [2, 204] }, o($Vr, [2, 162], { 47: $Vx }), o($Vr, [2, 163], { 47: [1, 46] }), o($Vy, [2, 61]), o($Vz, $V0, { 51: 5, 17: 7, 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 50: 47, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $V7, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $Ve, 53: $Vf, 54: $Vg, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vy, $VA, { 15: 48, 33: $VB, 48: $Vd, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VQ, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 10: 64, 45: 65, 17: 66, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vy, [2, 67]), o($Vy, [2, 68], { 5: 32, 6: 33, 39: 40, 42: 42, 3: 69, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 41: $Vb, 81: $Vp, 102: $Vw }), { 3: 70, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, o($VU, $VV, { 8: 76, 9: $VW, 13: $VX, 32: $VY, 37: $VZ, 56: $V_, 57: $V$, 73: $V01, 96: $V11 }), { 32: [1, 81], 57: [1, 80] }, { 3: 82, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 49: $V21, 81: $Vp, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 85, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: $V31, 49: $V41, 55: 13, 57: $V51, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 89, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: [1, 90], 55: 13, 57: [1, 88], 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 92, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: [1, 93], 55: 13, 57: [1, 91], 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o([1, 12, 19, 20, 22, 24, 25, 26, 30, 33, 34, 35, 46, 47, 48, 58, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 79, 82, 105], [2, 99], { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 17: 94, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $V61, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 9: [1, 96] }, { 9: [1, 97] }, { 75: [1, 98], 76: [1, 99] }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 100, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 15: 101, 48: $Vd }, o([1, 12, 19, 20, 22, 24, 25, 26, 30, 33, 34, 35, 46, 47, 58, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 79, 82, 105], [2, 125], { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 17: 102, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 48: [1, 103], 49: $V61, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($VU, [2, 126], { 4: [1, 104] }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 15: 107, 16: $V4, 17: 108, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: $Vd, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 82: $V71, 83: $Vq, 84: $Vr, 85: $Vs, 86: 105, 87: 106, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 15: 110, 48: $Vd }, o($V81, $V91, { 5: 32, 6: 33, 39: 40, 42: 42, 3: 111, 94: 112, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 41: $Vb, 81: $Vp, 96: $Va1, 102: $Vw }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 15: 115, 16: $V4, 17: 114, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: $Vd, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 48: [1, 116] }, o([1, 9, 12, 13, 19, 20, 22, 24, 25, 26, 30, 32, 33, 34, 35, 37, 46, 47, 48, 56, 57, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 79, 81, 82, 96, 102, 104, 105], $Vb1), o($Vc1, $Vd1), o($Vc1, [2, 3]), o($Vc1, [2, 4]), { 9: [1, 117] }, o($Ve1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 118, 10: 121, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 34: $Vf1, 36: $Vg1, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vh1, $Vi1, { 3: 12, 55: 13, 6: 33, 39: 40, 42: 42, 43: 123, 100: 124, 98: 126, 17: 127, 5: 131, 4: $Vj1, 7: $V2, 14: $V3, 16: [1, 122], 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 48: $Vk1, 49: $Vl1, 53: $Vm1, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vn1, $V0, { 50: 3, 15: 4, 51: 5, 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 17: 133, 101: 141, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 24: [1, 132], 26: [1, 134], 27: [1, 135], 28: [1, 136], 29: [1, 137], 31: [1, 138], 32: [1, 139], 33: [1, 140], 38: $Va, 41: $Vb, 44: $Vc, 48: $Vd, 49: $Ve, 53: $Vf, 54: $Vg, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 142, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 15: 143, 48: $Vd }, o($Vo1, [2, 41]), o($Vo1, [2, 42]), { 3: 144, 4: [1, 146], 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 145, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 36: [1, 147], 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 148, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vy, [2, 63], { 17: 7, 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 51: 149, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $V7, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $Ve, 53: $Vf, 54: $Vg, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o([1, 25, 47], $V0, { 51: 5, 17: 7, 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 50: 150, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $V7, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $Ve, 53: $Vf, 54: $Vg, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 20: [1, 151], 47: $Vx }, o($Vy, [2, 65]), { 3: 152, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 153, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: [1, 154], 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 155, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 156, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 157, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 158, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 159, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 160, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 161, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 162, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 163, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 164, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 165, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 166, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 167, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vp1, $Vq1, { 11: 168, 46: $Vr1 }), o($Vs1, [2, 51]), o($Vs1, $Vt1, { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($Vs1, [2, 57], { 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 17: 170, 3: 171, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $V61, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($VQ, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 172, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o([32, 57], $Vu1, { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), o($Vy, [2, 69], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 15: 174, 16: $V4, 17: 173, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: $Vd, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 175, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: [1, 176], 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU, [2, 82]), o($VU, [2, 113]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 177, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, [2, 5]), o($Vv1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 178, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vc1, [2, 7]), { 4: [1, 180], 5: 181, 6: 182, 16: [1, 179], 21: [1, 183], 23: [1, 184], 41: $Vb, 42: 42 }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 185, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU, [2, 84]), o($VU, [2, 81], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), { 3: 186, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, { 3: 187, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 49: [1, 188], 81: $Vp, 102: $Vw }, o($Vw1, [2, 91], { 33: $VB, 65: $VH, 69: $VL }), { 3: 171, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 189, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: [1, 190], 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 191, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 3: 192, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 49: [1, 193], 81: $Vp, 102: $Vw }, o($Vw1, [2, 92], { 33: $VB, 65: $VH, 69: $VL }), { 3: 171, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 194, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 195, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 49: [1, 196], 81: $Vp, 102: $Vw }, o($Vw1, [2, 93], { 33: $VB, 65: $VH, 69: $VL }), { 3: 171, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 197, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vy1, [2, 100], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO }), { 3: 69, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, o($Vv1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 198, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vv1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 199, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 9: [1, 200] }, { 9: [1, 201] }, { 15: 202, 33: $VB, 48: $Vd, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 81: [1, 203] }, o($Vy1, [2, 123], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO }), o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 204, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($VU, [2, 127]), { 46: $Vz1, 82: $V71, 87: 205 }, o($VA1, [2, 131], { 82: $VB1, 88: [1, 207], 89: [1, 208] }), o($VU, [2, 134]), o($VC1, [2, 147], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 108, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 86: 210, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU, [2, 135], { 91: [1, 211], 92: [1, 212] }), o($V81, $V91, { 8: 76, 94: 213, 9: $VW, 13: $VX, 37: $VZ, 96: $Va1 }), { 48: $VD1, 95: 214, 105: $VE1 }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 216, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VF1, [2, 144], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM }), o($VU, [2, 145]), o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 217, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vv1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 218, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Ve1, $Vt1, { 18: 219, 39: 221, 33: $VB, 34: [1, 220], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 81: $Vp, 102: $Vw }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 222, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 223, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VG1, $Vq1, { 11: 224, 46: $Vr1 }), o($Ve1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 118, 10: 225, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 34: $Vf1, 36: $Vg1, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o([22, 47], $Vq1, { 11: 226, 46: $VH1 }), o($VI1, [2, 157]), o([20, 46, 47], $Vi1, { 3: 12, 55: 13, 6: 33, 39: 40, 42: 42, 100: 124, 98: 126, 17: 127, 5: 131, 43: 228, 4: $Vj1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 48: $Vk1, 49: $Vl1, 53: $Vm1, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 229, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: [1, 230], 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VI1, [2, 153], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), { 3: 171, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 231, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VI1, [2, 155]), o($VJ1, $Vb1, { 99: [1, 232] }), o($VJ1, $Vd1, { 99: [1, 233] }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 235, 21: $V5, 23: $V6, 25: [1, 234], 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vn1, $VA, { 15: 48, 24: [1, 236], 26: [1, 237], 33: [1, 238], 48: $Vd, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 240, 21: $V5, 23: $V6, 25: [1, 239], 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 9: [1, 242], 25: [1, 241] }, { 25: [1, 243] }, o($VQ, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 244, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 85, 21: $V5, 23: $V6, 25: [1, 245], 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 48: $V31, 49: $V41, 55: 13, 57: $V51, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 82, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 25: [1, 246], 38: $Va, 39: 40, 41: $Vb, 42: 42, 49: $V21, 81: $Vp, 102: $Vw }, { 3: 247, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, { 25: [1, 248] }, { 15: 249, 33: $VB, 48: $Vd, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, $VK1, { 40: 250, 89: $VL1 }), o([19, 20, 22, 33, 35, 47, 48, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 79, 81, 82, 102], $VV, { 8: 76, 9: $VW, 13: $VX, 32: $VY, 37: $VZ, 56: $V_, 57: $V$, 73: $V01, 96: $V11, 103: [1, 252] }), o($VM1, [2, 172], { 33: $VB, 35: [1, 254], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 253] }), o([9, 13, 19, 20, 22, 32, 33, 35, 37, 47, 48, 56, 57, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 79, 81, 82, 96, 102, 103], $Vb1, { 36: [1, 257], 46: [1, 256], 104: [1, 255] }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 258, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 190], { 33: $VB, 46: [1, 260], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 259] }), o($Vy, [2, 62]), o($Vr, [2, 164], { 47: $Vx }), o([1, 9, 12, 13, 19, 20, 22, 24, 25, 26, 30, 32, 33, 34, 35, 37, 46, 47, 48, 56, 57, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 79, 81, 82, 88, 89, 91, 92, 96, 102, 103, 104, 105], [2, 70]), { 8: 76, 9: $VW, 13: $VX, 33: [1, 261], 37: $VZ }, o($VN1, [2, 79], { 33: $VB, 59: $VD, 64: $VG, 65: $VH, 69: $VL }), o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 262, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o([1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 58, 59, 62, 63, 66, 67, 68, 70, 71, 72, 79, 81, 82, 102, 105], [2, 101], { 33: $VB, 64: $VG, 65: $VH, 69: $VL }), o($VO1, [2, 102], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 64: $VG, 65: $VH, 66: $VI, 68: $VK, 69: $VL, 70: $VM }), o($VF1, [2, 103], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM }), o($Vw1, [2, 104], { 33: $VB, 65: $VH, 69: $VL }), o($Vw1, [2, 105], { 33: $VB, 65: $VH, 69: $VL }), o($VN1, [2, 106], { 33: $VB, 59: $VD, 64: $VG, 65: $VH, 69: $VL }), o($VO1, [2, 107], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 64: $VG, 65: $VH, 66: $VI, 68: $VK, 69: $VL, 70: $VM }), o($VP1, [2, 108], { 33: $VB, 58: $VC, 59: $VD, 64: $VG, 65: $VH, 66: $VI, 68: $VK, 69: $VL }), o([1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 58, 59, 62, 63, 64, 65, 66, 67, 68, 70, 71, 72, 79, 81, 82, 102, 105], [2, 109], { 33: $VB, 69: $VL }), o($VP1, [2, 110], { 33: $VB, 58: $VC, 59: $VD, 64: $VG, 65: $VH, 66: $VI, 68: $VK, 69: $VL }), o($VF1, [2, 111], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM }), o($Vy1, [2, 112], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO }), o($Vy1, [2, 120], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO }), { 30: [1, 263], 47: $VQ1, 48: $VR1 }, o([12, 19, 20, 30, 47, 48], $VS1, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 17: 66, 45: 266, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vs1, [2, 56], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VU, $VV, { 8: 76, 9: $VW, 13: $VX, 32: $Vu1, 57: $Vu1, 37: $VZ, 56: $V_, 73: $V01, 96: $V11 }), o($Vp1, $Vq1, { 11: 267, 46: $Vr1 }), o($VN1, [2, 72], { 33: $VB, 59: $VD, 64: $VG, 65: $VH, 69: $VL }), o($VU, [2, 73]), o($Vy1, [2, 76], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO }), o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 268, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($VF1, [2, 143], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM }), o($VT1, $Vq1, { 11: 269, 46: $Vr1 }), o($Ve1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 10: 121, 17: 270, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 34: [1, 271], 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vc1, [2, 43]), o($Vc1, [2, 44]), o($Vc1, [2, 45]), o($Vh1, $Vi1, { 3: 12, 55: 13, 6: 33, 39: 40, 42: 42, 43: 123, 100: 124, 98: 126, 17: 127, 5: 131, 4: $Vj1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 48: $Vk1, 49: $Vl1, 53: $Vm1, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vn1, $V0, { 50: 3, 15: 4, 51: 5, 17: 7, 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 101: 141, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $V7, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 48: $Vd, 49: $Ve, 53: $Vf, 54: $Vg, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vy1, [2, 77], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO }), o($VU, [2, 83], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), o($VU, [2, 85], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), { 3: 272, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, o($Vw1, [2, 94], { 33: $VB, 65: $VH, 69: $VL }), o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 273, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($VU1, $Vq1, { 11: 274, 46: $Vr1 }), o($VU, [2, 86], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), { 3: 275, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, o($Vw1, [2, 95], { 33: $VB, 65: $VH, 69: $VL }), o($VU, [2, 87], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), { 3: 276, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, o($Vw1, [2, 96], { 33: $VB, 65: $VH, 69: $VL }), o($VT1, $Vq1, { 11: 277, 46: $Vr1 }), o($VT1, $Vq1, { 11: 278, 46: $Vr1 }), o($Vv1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 279, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vv1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 280, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($VU, $VK1, { 40: 281, 89: $VL1 }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 282, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU1, $Vq1, { 11: 283, 46: $Vr1 }), o($VA1, [2, 128], { 82: $VB1, 88: [1, 284], 89: [1, 285] }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 286, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 15: 287, 48: $Vd }, { 15: 288, 48: $Vd }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 108, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 86: 289, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 15: 290, 46: $Vz1, 48: $Vd }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 15: 291, 16: $V4, 17: 66, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 45: 292, 48: $Vd, 49: $VT, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 15: 293, 48: $Vd }, { 48: $VD1, 95: 294, 105: $VE1 }, { 15: 295, 48: $Vd }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 108, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 86: 296, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($V81, [2, 200], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VU1, $Vq1, { 11: 297, 46: $Vr1 }), o($VT1, $Vq1, { 11: 298, 46: $Vr1 }), { 19: [1, 299], 20: [1, 300], 39: 301, 47: $VV1, 48: $VW1, 81: $Vp, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 304, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 194]), { 33: $VB, 34: [1, 305], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 19: [1, 306], 33: $VB, 35: [1, 307], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 19: [1, 308], 47: $VQ1, 48: $VR1 }, o($VG1, $Vq1, { 11: 309, 46: $Vr1 }), { 22: [1, 310], 47: $VX1 }, o([20, 22, 47], $VS1, { 3: 12, 55: 13, 6: 33, 39: 40, 42: 42, 98: 126, 17: 127, 5: 131, 100: 312, 4: $Vj1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $Vl1, 53: $Vm1, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vz, $Vq1, { 11: 313, 46: $VH1 }), o($VI1, [2, 151], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 314, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($VI1, [2, 154], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VY1, [2, 149]), o($VY1, [2, 150]), o($Vc1, [2, 12]), { 25: [1, 315], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 25: [1, 316] }, { 25: [1, 317] }, { 3: 318, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, o($Vc1, [2, 15]), { 25: [1, 319], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, [2, 18]), o($Vv1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 320, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vc1, [2, 20]), o($Vp1, $Vq1, { 11: 321, 46: $Vr1 }), o($Vc1, [2, 22]), o($Vc1, [2, 23]), { 8: 76, 9: $VW, 13: $VX, 33: [1, 322], 37: $VZ }, o($Vo1, [2, 161]), o($Vc1, [2, 39]), o($Vc1, [2, 40]), { 15: 323, 48: $Vd, 78: [1, 324] }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 325, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 326, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 327, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 328, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 329, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 38: $Va, 39: 40, 41: $Vb, 42: 42, 81: $Vp, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 330, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 33: $VB, 34: [1, 331], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 332, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 333, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 334, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU1, $Vq1, { 11: 335, 46: $Vr1 }), { 52: $VZ1, 74: $V_1 }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 66, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 45: 338, 49: $VT, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vx1, $VR, { 3: 12, 55: 13, 5: 32, 6: 33, 39: 40, 42: 42, 45: 65, 17: 66, 10: 339, 4: $V1, 7: $V2, 14: $V3, 16: $V4, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 41: $Vb, 44: $Vc, 49: $VT, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }), o($Vs1, [2, 52]), { 30: [1, 340], 47: $VQ1, 48: $VR1 }, o($VU1, $Vq1, { 11: 341, 46: $Vr1 }), { 12: [1, 342], 47: $VQ1, 48: $VR1 }, o($Ve1, $Vt1, { 33: $VB, 34: [1, 343], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 344, 19: [1, 345], 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU, [2, 88], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), o($VU1, $Vq1, { 11: 346, 46: $Vr1 }), { 20: [1, 347], 47: $VQ1, 48: $VR1 }, o($VU, [2, 89], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), o($VU, [2, 90], { 8: 76, 9: $VW, 13: $VX, 37: $VZ }), { 12: [1, 348], 47: $VQ1, 48: $VR1 }, { 12: [1, 349], 47: $VQ1, 48: $VR1 }, o($VT1, $Vq1, { 11: 350, 46: $Vr1 }), o($VT1, $Vq1, { 11: 351, 46: $Vr1 }), o($VU, [2, 119]), o([1, 12, 19, 20, 22, 24, 25, 26, 30, 34, 35, 46, 47, 48, 71, 72, 79, 81, 102, 105], [2, 121], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 82: [1, 352] }), { 20: [1, 353], 47: $VQ1, 48: $VR1 }, { 15: 354, 48: $Vd }, { 15: 355, 48: $Vd }, o($VC1, [2, 148], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VU, [2, 132]), o($VU, [2, 133]), { 15: 356, 46: $Vz1, 48: $Vd }, o($V$1, [2, 198]), o($VU, [2, 136], { 92: [1, 357] }), { 15: 358, 48: $Vd }, o($VU, [2, 140]), { 15: 359, 48: $Vd }, o($VU, [2, 142]), { 46: $Vz1, 48: [2, 202] }, { 20: [1, 360], 47: $VQ1, 48: $VR1 }, { 12: [1, 361], 47: $VQ1, 48: $VR1 }, o($Vc1, [2, 9]), { 19: [1, 362] }, o($VM1, [2, 195]), { 39: 363, 81: $Vp, 102: $Vw }, { 39: 364, 81: $Vp, 102: $Vw }, { 19: [1, 365], 33: $VB, 35: [1, 366], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 367, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, [2, 31]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 368, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, $V02, { 44: $V12 }), { 19: [1, 370], 47: $VQ1, 48: $VR1 }, o($Vc1, [2, 47], { 44: [1, 371] }), { 3: 12, 4: $Vj1, 5: 131, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 127, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $Vl1, 53: $Vm1, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 98: 126, 100: 372, 102: $Vw }, o($VI1, [2, 158]), { 20: [1, 373], 47: $VX1 }, o($VU1, $Vq1, { 11: 374, 46: $Vr1 }), o($Vc1, [2, 13]), o($Vc1, [2, 14]), o($Vc1, [2, 17]), { 8: 76, 9: $VW, 13: $VX, 33: [1, 375], 37: $VZ }, o($Vc1, [2, 16]), o($VT1, $Vq1, { 11: 376, 46: $Vr1 }), { 30: [1, 377], 47: $VQ1, 48: $VR1 }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 379, 21: $V5, 23: $V6, 25: [1, 378], 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, [2, 166]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 380, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 168], { 33: $VB, 35: [1, 382], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 381] }), o($VM1, [2, 173], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 174], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 383] }), o($VM1, [2, 176], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 384] }), { 8: 76, 9: $VW, 13: $VX, 37: $VZ, 104: [1, 385] }, { 33: $VB, 34: [1, 386], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 387, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 191], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 192], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 388] }), o($VU, [2, 74]), { 20: [1, 389], 47: $VQ1, 48: $VR1 }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 390, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 15: 391, 48: $Vd }, o($Vs1, [2, 53]), o($VU1, $Vq1, { 11: 392, 46: $Vr1 }), { 74: $V_1 }, { 20: [1, 393], 47: $VQ1, 48: $VR1 }, o($Vc1, [2, 6]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 394, 19: [1, 395], 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 19: [1, 397], 33: $VB, 35: [1, 396], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, [2, 38]), { 20: [1, 398], 47: $VQ1, 48: $VR1 }, o($VU, [2, 98]), { 15: 399, 48: $Vd }, { 15: 400, 48: $Vd }, { 12: [1, 401], 47: $VQ1, 48: $VR1 }, { 12: [1, 402], 47: $VQ1, 48: $VR1 }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 403, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU, [2, 124]), o($VU, [2, 129]), o($VU, [2, 130]), o($V$1, [2, 199]), { 15: 404, 48: $Vd }, o($VU, [2, 138], { 92: [1, 405] }), o($VU, [2, 141]), o($VU, [2, 146]), { 15: 406, 48: $Vd }, o($Vc1, [2, 10]), o($VM1, [2, 196]), o($VM1, [2, 197]), o($Vc1, [2, 27]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 407, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 19: [1, 408], 33: $VB, 35: [1, 409], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 19: [1, 410], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, [2, 48]), o([9, 13, 22, 32, 33, 37, 46, 47, 56, 57, 58, 59, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 79, 96], $V02, { 39: 221, 18: 411, 44: $V12, 81: $Vp, 102: $Vw }), o($Vc1, [2, 49]), o($VI1, [2, 159]), o($VI1, [2, 160]), { 20: [1, 412], 47: $VQ1, 48: $VR1 }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 334, 21: $V5, 23: $V6, 25: [1, 413], 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 12: [1, 414], 47: $VQ1, 48: $VR1 }, { 28: [1, 415], 52: $VZ1, 74: $V_1 }, o($Vc1, [2, 24]), { 25: [1, 416], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 15: 417, 33: $VB, 48: $Vd, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 418, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 419, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 420, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 421, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 422, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 423, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 181], { 33: $VB, 35: [1, 425], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 424] }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 426, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VU, [2, 80]), o($Vy, [2, 66], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VU, [2, 114]), { 20: [1, 427], 47: $VQ1, 48: $VR1 }, o($VU, [2, 78]), { 19: [1, 429], 33: $VB, 35: [1, 428], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, [2, 36]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 430, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, [2, 37]), o($VU, [2, 97]), o($VU, [2, 115]), o($VU, [2, 116]), { 15: 431, 48: $Vd }, { 15: 432, 48: $Vd }, o($VF1, [2, 122], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM }), o($VU, [2, 137]), { 15: 433, 48: $Vd }, o($Vc1, [2, 8]), { 19: [1, 434], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, [2, 29]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 435, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, [2, 32]), { 22: [1, 436], 39: 301, 47: $VV1, 48: $VW1, 81: $Vp, 102: $Vw }, o($VI1, [2, 152]), o($Vc1, [2, 25]), { 25: [1, 437] }, { 25: [1, 438] }, o($Vc1, [2, 26]), o($Vc1, $VK1, { 40: 439, 89: $VL1 }), o($VM1, [2, 169], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 170], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 440] }), o($VM1, [2, 175], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 177], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 178], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 441] }), o($VM1, [2, 180], { 33: $VB, 35: [1, 443], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 442] }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 444, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 445, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 193], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($Vs1, [2, 54]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 446, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, [2, 35]), { 19: [1, 447], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($VU, [2, 117]), o($VU, [2, 118]), o($VU, [2, 139]), o($Vc1, [2, 28]), { 19: [1, 448], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, [2, 11]), o($Vc1, [2, 19]), o($Vc1, [2, 21]), o($Vc1, [2, 167]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 449, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 450, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 451, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 452, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 183], { 33: $VB, 35: [1, 453], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 185], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 454] }), { 19: [1, 455], 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }, o($Vc1, [2, 34]), o($Vc1, [2, 30]), o($VM1, [2, 171], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 179], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 182], { 33: $VB, 35: [1, 456], 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 184], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP, 82: [1, 457] }), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 458, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 459, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($Vc1, [2, 33]), { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 460, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, { 3: 12, 4: $V1, 5: 32, 6: 33, 7: $V2, 14: $V3, 16: $V4, 17: 461, 21: $V5, 23: $V6, 29: $VS, 31: $V8, 32: $V9, 38: $Va, 39: 40, 41: $Vb, 42: 42, 44: $Vc, 49: $V61, 55: 13, 59: $Vh, 60: $Vi, 61: $Vj, 75: $Vk, 76: $Vl, 77: $Vm, 78: $Vn, 80: $Vo, 81: $Vp, 83: $Vq, 84: $Vr, 85: $Vs, 90: $Vt, 93: $Vu, 97: $Vv, 102: $Vw }, o($VM1, [2, 189], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 187], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 188], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP }), o($VM1, [2, 186], { 33: $VB, 58: $VC, 59: $VD, 62: $VE, 63: $VF, 64: $VG, 65: $VH, 66: $VI, 67: $VJ, 68: $VK, 69: $VL, 70: $VM, 71: $VN, 72: $VO, 79: $VP })],
          defaultActions: { 2: [2, 204] },
          parseError: function parseError(str, hash) {
            if (hash.recoverable) {
              this.trace(str);
            } else {
              var error = new Error(str);
              error.hash = hash;
              throw error;
            }
          },
          parse: function parse(input) {
            var self = this, stack = [0], tstack = [], vstack = [null], lstack = [], table = this.table, yytext = "", yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
            var args = lstack.slice.call(arguments, 1);
            var lexer = Object.create(this.lexer);
            var sharedState = { yy: {} };
            for (var k in this.yy) {
              if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
                sharedState.yy[k] = this.yy[k];
              }
            }
            lexer.setInput(input, sharedState.yy);
            sharedState.yy.lexer = lexer;
            sharedState.yy.parser = this;
            if (typeof lexer.yylloc == "undefined") {
              lexer.yylloc = {};
            }
            var yyloc = lexer.yylloc;
            lstack.push(yyloc);
            var ranges = lexer.options && lexer.options.ranges;
            if (typeof sharedState.yy.parseError === "function") {
              this.parseError = sharedState.yy.parseError;
            } else {
              this.parseError = Object.getPrototypeOf(this).parseError;
            }
            function popStack(n) {
              stack.length = stack.length - 2 * n;
              vstack.length = vstack.length - n;
              lstack.length = lstack.length - n;
            }
            _token_stack:
              var lex = function() {
                var token;
                token = lexer.lex() || EOF;
                if (typeof token !== "number") {
                  token = self.symbols_[token] || token;
                }
                return token;
              };
            var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
            while (true) {
              state = stack[stack.length - 1];
              if (this.defaultActions[state]) {
                action = this.defaultActions[state];
              } else {
                if (symbol === null || typeof symbol == "undefined") {
                  symbol = lex();
                }
                action = table[state] && table[state][symbol];
              }
              if (typeof action === "undefined" || !action.length || !action[0]) {
                var errStr = "";
                expected = [];
                for (p in table[state]) {
                  if (this.terminals_[p] && p > TERROR) {
                    expected.push("'" + this.terminals_[p] + "'");
                  }
                }
                if (lexer.showPosition) {
                  errStr = "Parse error on line " + (yylineno + 1) + ":\n" + lexer.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
                } else {
                  errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == EOF ? "end of input" : "'" + (this.terminals_[symbol] || symbol) + "'");
                }
                this.parseError(errStr, {
                  text: lexer.match,
                  token: this.terminals_[symbol] || symbol,
                  line: lexer.yylineno,
                  loc: yyloc,
                  expected
                });
              }
              if (action[0] instanceof Array && action.length > 1) {
                throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
              }
              switch (action[0]) {
                case 1:
                  stack.push(symbol);
                  vstack.push(lexer.yytext);
                  lstack.push(lexer.yylloc);
                  stack.push(action[1]);
                  symbol = null;
                  if (!preErrorSymbol) {
                    yyleng = lexer.yyleng;
                    yytext = lexer.yytext;
                    yylineno = lexer.yylineno;
                    yyloc = lexer.yylloc;
                    if (recovering > 0) {
                      recovering--;
                    }
                  } else {
                    symbol = preErrorSymbol;
                    preErrorSymbol = null;
                  }
                  break;
                case 2:
                  len = this.productions_[action[1]][1];
                  yyval.$ = vstack[vstack.length - len];
                  yyval._$ = {
                    first_line: lstack[lstack.length - (len || 1)].first_line,
                    last_line: lstack[lstack.length - 1].last_line,
                    first_column: lstack[lstack.length - (len || 1)].first_column,
                    last_column: lstack[lstack.length - 1].last_column
                  };
                  if (ranges) {
                    yyval._$.range = [
                      lstack[lstack.length - (len || 1)].range[0],
                      lstack[lstack.length - 1].range[1]
                    ];
                  }
                  r = this.performAction.apply(yyval, [
                    yytext,
                    yyleng,
                    yylineno,
                    sharedState.yy,
                    action[1],
                    vstack,
                    lstack
                  ].concat(args));
                  if (typeof r !== "undefined") {
                    return r;
                  }
                  if (len) {
                    stack = stack.slice(0, -1 * len * 2);
                    vstack = vstack.slice(0, -1 * len);
                    lstack = lstack.slice(0, -1 * len);
                  }
                  stack.push(this.productions_[action[1]][0]);
                  vstack.push(yyval.$);
                  lstack.push(yyval._$);
                  newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
                  stack.push(newState);
                  break;
                case 3:
                  return true;
              }
            }
            return true;
          }
        };
        function Parser() {
          this.yy = {};
        }
        Parser.prototype = parser2;
        parser2.Parser = Parser;
        return new Parser();
      })();
      if (typeof __require !== "undefined" && typeof exports !== "undefined") {
        exports.parser = parser;
        exports.Parser = parser.Parser;
        exports.parse = function() {
          return parser.parse.apply(parser, arguments);
        };
        exports.main = function commonjsMain(args) {
          if (!args[1]) {
            console.log("Usage: " + args[0] + " FILE");
            process.exit(1);
          }
          var source = require_stub_fs().readFileSync(require_stub_path().normalize(args[1]), "utf8");
          return exports.parser.parse(source);
        };
        if (typeof module !== "undefined" && __require.main === module) {
          exports.main(process.argv.slice(1));
        }
      }
    }
  });

  // ../../node_modules/prelude-ls/lib/Func.js
  var require_Func = __commonJS({
    "../../node_modules/prelude-ls/lib/Func.js"(exports, module) {
      init_shim_buffer();
      var apply;
      var curry;
      var flip;
      var fix;
      var over;
      var memoize;
      var toString$ = {}.toString;
      apply = curry$(function(f, list) {
        return f.apply(null, list);
      });
      curry = function(f) {
        return curry$(f);
      };
      flip = curry$(function(f, x, y) {
        return f(y, x);
      });
      fix = function(f) {
        return /* @__PURE__ */ (function(g) {
          return function() {
            return f(g(g)).apply(null, arguments);
          };
        })(function(g) {
          return function() {
            return f(g(g)).apply(null, arguments);
          };
        });
      };
      over = curry$(function(f, g, x, y) {
        return f(g(x), g(y));
      });
      memoize = function(f) {
        var memo;
        memo = {};
        return function() {
          var args, res$, i$, to$, key, arg;
          res$ = [];
          for (i$ = 0, to$ = arguments.length; i$ < to$; ++i$) {
            res$.push(arguments[i$]);
          }
          args = res$;
          key = (function() {
            var i$2, ref$, len$, results$ = [];
            for (i$2 = 0, len$ = (ref$ = args).length; i$2 < len$; ++i$2) {
              arg = ref$[i$2];
              results$.push(arg + toString$.call(arg).slice(8, -1));
            }
            return results$;
          })().join("");
          return memo[key] = key in memo ? memo[key] : f.apply(null, args);
        };
      };
      module.exports = {
        curry,
        flip,
        fix,
        apply,
        over,
        memoize
      };
      function curry$(f, bound) {
        var context, _curry = function(args) {
          return f.length > 1 ? function() {
            var params = args ? args.concat() : [];
            context = bound ? context || this : this;
            return params.push.apply(params, arguments) < f.length && arguments.length ? _curry.call(context, params) : f.apply(context, params);
          } : f;
        };
        return _curry();
      }
    }
  });

  // ../../node_modules/prelude-ls/lib/List.js
  var require_List = __commonJS({
    "../../node_modules/prelude-ls/lib/List.js"(exports, module) {
      init_shim_buffer();
      var each;
      var map;
      var compact;
      var filter;
      var reject;
      var remove;
      var partition;
      var find;
      var head;
      var first;
      var tail;
      var last;
      var initial;
      var empty;
      var reverse;
      var unique;
      var uniqueBy;
      var fold;
      var foldl;
      var fold1;
      var foldl1;
      var foldr;
      var foldr1;
      var unfoldr;
      var concat;
      var concatMap;
      var flatten;
      var difference;
      var intersection;
      var union;
      var countBy;
      var groupBy;
      var andList;
      var orList;
      var any;
      var all;
      var sort;
      var sortWith;
      var sortBy;
      var sum;
      var product;
      var mean;
      var average;
      var maximum;
      var minimum;
      var maximumBy;
      var minimumBy;
      var scan;
      var scanl;
      var scan1;
      var scanl1;
      var scanr;
      var scanr1;
      var slice;
      var take;
      var drop;
      var splitAt;
      var takeWhile;
      var dropWhile;
      var span;
      var breakList;
      var zip;
      var zipWith;
      var zipAll;
      var zipAllWith;
      var at;
      var elemIndex;
      var elemIndices;
      var findIndex;
      var findIndices;
      var toString$ = {}.toString;
      each = curry$(function(f, xs) {
        var i$, len$, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          f(x);
        }
        return xs;
      });
      map = curry$(function(f, xs) {
        var i$, len$, x, results$ = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          results$.push(f(x));
        }
        return results$;
      });
      compact = function(xs) {
        var i$, len$, x, results$ = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (x) {
            results$.push(x);
          }
        }
        return results$;
      };
      filter = curry$(function(f, xs) {
        var i$, len$, x, results$ = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (f(x)) {
            results$.push(x);
          }
        }
        return results$;
      });
      reject = curry$(function(f, xs) {
        var i$, len$, x, results$ = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (!f(x)) {
            results$.push(x);
          }
        }
        return results$;
      });
      remove = curry$(function(el, xs) {
        var i, x$;
        i = elemIndex(el, xs);
        x$ = xs.slice();
        if (i != null) {
          x$.splice(i, 1);
        }
        return x$;
      });
      partition = curry$(function(f, xs) {
        var passed, failed, i$, len$, x;
        passed = [];
        failed = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          (f(x) ? passed : failed).push(x);
        }
        return [passed, failed];
      });
      find = curry$(function(f, xs) {
        var i$, len$, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (f(x)) {
            return x;
          }
        }
      });
      head = first = function(xs) {
        return xs[0];
      };
      tail = function(xs) {
        if (!xs.length) {
          return;
        }
        return xs.slice(1);
      };
      last = function(xs) {
        return xs[xs.length - 1];
      };
      initial = function(xs) {
        if (!xs.length) {
          return;
        }
        return xs.slice(0, -1);
      };
      empty = function(xs) {
        return !xs.length;
      };
      reverse = function(xs) {
        return xs.concat().reverse();
      };
      unique = function(xs) {
        var result, i$, len$, x;
        result = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (!in$(x, result)) {
            result.push(x);
          }
        }
        return result;
      };
      uniqueBy = curry$(function(f, xs) {
        var seen, i$, len$, x, val, results$ = [];
        seen = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          val = f(x);
          if (in$(val, seen)) {
            continue;
          }
          seen.push(val);
          results$.push(x);
        }
        return results$;
      });
      fold = foldl = curry$(function(f, memo, xs) {
        var i$, len$, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          memo = f(memo, x);
        }
        return memo;
      });
      fold1 = foldl1 = curry$(function(f, xs) {
        return fold(f, xs[0], xs.slice(1));
      });
      foldr = curry$(function(f, memo, xs) {
        var i$, x;
        for (i$ = xs.length - 1; i$ >= 0; --i$) {
          x = xs[i$];
          memo = f(x, memo);
        }
        return memo;
      });
      foldr1 = curry$(function(f, xs) {
        return foldr(f, xs[xs.length - 1], xs.slice(0, -1));
      });
      unfoldr = curry$(function(f, b) {
        var result, x, that;
        result = [];
        x = b;
        while ((that = f(x)) != null) {
          result.push(that[0]);
          x = that[1];
        }
        return result;
      });
      concat = function(xss) {
        return [].concat.apply([], xss);
      };
      concatMap = curry$(function(f, xs) {
        var x;
        return [].concat.apply([], (function() {
          var i$, ref$, len$, results$ = [];
          for (i$ = 0, len$ = (ref$ = xs).length; i$ < len$; ++i$) {
            x = ref$[i$];
            results$.push(f(x));
          }
          return results$;
        })());
      });
      flatten = function(xs) {
        var x;
        return [].concat.apply([], (function() {
          var i$, ref$, len$, results$ = [];
          for (i$ = 0, len$ = (ref$ = xs).length; i$ < len$; ++i$) {
            x = ref$[i$];
            if (toString$.call(x).slice(8, -1) === "Array") {
              results$.push(flatten(x));
            } else {
              results$.push(x);
            }
          }
          return results$;
        })());
      };
      difference = function(xs) {
        var yss, res$, i$, to$, results, len$, x, j$, len1$, ys;
        res$ = [];
        for (i$ = 1, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        yss = res$;
        results = [];
        outer: for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          for (j$ = 0, len1$ = yss.length; j$ < len1$; ++j$) {
            ys = yss[j$];
            if (in$(x, ys)) {
              continue outer;
            }
          }
          results.push(x);
        }
        return results;
      };
      intersection = function(xs) {
        var yss, res$, i$, to$, results, len$, x, j$, len1$, ys;
        res$ = [];
        for (i$ = 1, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        yss = res$;
        results = [];
        outer: for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          for (j$ = 0, len1$ = yss.length; j$ < len1$; ++j$) {
            ys = yss[j$];
            if (!in$(x, ys)) {
              continue outer;
            }
          }
          results.push(x);
        }
        return results;
      };
      union = function() {
        var xss, res$, i$, to$, results, len$, xs, j$, len1$, x;
        res$ = [];
        for (i$ = 0, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        xss = res$;
        results = [];
        for (i$ = 0, len$ = xss.length; i$ < len$; ++i$) {
          xs = xss[i$];
          for (j$ = 0, len1$ = xs.length; j$ < len1$; ++j$) {
            x = xs[j$];
            if (!in$(x, results)) {
              results.push(x);
            }
          }
        }
        return results;
      };
      countBy = curry$(function(f, xs) {
        var results, i$, len$, x, key;
        results = {};
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          key = f(x);
          if (key in results) {
            results[key] += 1;
          } else {
            results[key] = 1;
          }
        }
        return results;
      });
      groupBy = curry$(function(f, xs) {
        var results, i$, len$, x, key;
        results = {};
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          key = f(x);
          if (key in results) {
            results[key].push(x);
          } else {
            results[key] = [x];
          }
        }
        return results;
      });
      andList = function(xs) {
        var i$, len$, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (!x) {
            return false;
          }
        }
        return true;
      };
      orList = function(xs) {
        var i$, len$, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (x) {
            return true;
          }
        }
        return false;
      };
      any = curry$(function(f, xs) {
        var i$, len$, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (f(x)) {
            return true;
          }
        }
        return false;
      });
      all = curry$(function(f, xs) {
        var i$, len$, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          if (!f(x)) {
            return false;
          }
        }
        return true;
      });
      sort = function(xs) {
        return xs.concat().sort(function(x, y) {
          if (x > y) {
            return 1;
          } else if (x < y) {
            return -1;
          } else {
            return 0;
          }
        });
      };
      sortWith = curry$(function(f, xs) {
        return xs.concat().sort(f);
      });
      sortBy = curry$(function(f, xs) {
        return xs.concat().sort(function(x, y) {
          if (f(x) > f(y)) {
            return 1;
          } else if (f(x) < f(y)) {
            return -1;
          } else {
            return 0;
          }
        });
      });
      sum = function(xs) {
        var result, i$, len$, x;
        result = 0;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          result += x;
        }
        return result;
      };
      product = function(xs) {
        var result, i$, len$, x;
        result = 1;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          result *= x;
        }
        return result;
      };
      mean = average = function(xs) {
        var sum2, i$, len$, x;
        sum2 = 0;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          x = xs[i$];
          sum2 += x;
        }
        return sum2 / xs.length;
      };
      maximum = function(xs) {
        var max, i$, ref$, len$, x;
        max = xs[0];
        for (i$ = 0, len$ = (ref$ = xs.slice(1)).length; i$ < len$; ++i$) {
          x = ref$[i$];
          if (x > max) {
            max = x;
          }
        }
        return max;
      };
      minimum = function(xs) {
        var min, i$, ref$, len$, x;
        min = xs[0];
        for (i$ = 0, len$ = (ref$ = xs.slice(1)).length; i$ < len$; ++i$) {
          x = ref$[i$];
          if (x < min) {
            min = x;
          }
        }
        return min;
      };
      maximumBy = curry$(function(f, xs) {
        var max, i$, ref$, len$, x;
        max = xs[0];
        for (i$ = 0, len$ = (ref$ = xs.slice(1)).length; i$ < len$; ++i$) {
          x = ref$[i$];
          if (f(x) > f(max)) {
            max = x;
          }
        }
        return max;
      });
      minimumBy = curry$(function(f, xs) {
        var min, i$, ref$, len$, x;
        min = xs[0];
        for (i$ = 0, len$ = (ref$ = xs.slice(1)).length; i$ < len$; ++i$) {
          x = ref$[i$];
          if (f(x) < f(min)) {
            min = x;
          }
        }
        return min;
      });
      scan = scanl = curry$(function(f, memo, xs) {
        var last2, x;
        last2 = memo;
        return [memo].concat((function() {
          var i$, ref$, len$, results$ = [];
          for (i$ = 0, len$ = (ref$ = xs).length; i$ < len$; ++i$) {
            x = ref$[i$];
            results$.push(last2 = f(last2, x));
          }
          return results$;
        })());
      });
      scan1 = scanl1 = curry$(function(f, xs) {
        if (!xs.length) {
          return;
        }
        return scan(f, xs[0], xs.slice(1));
      });
      scanr = curry$(function(f, memo, xs) {
        xs = xs.concat().reverse();
        return scan(f, memo, xs).reverse();
      });
      scanr1 = curry$(function(f, xs) {
        if (!xs.length) {
          return;
        }
        xs = xs.concat().reverse();
        return scan(f, xs[0], xs.slice(1)).reverse();
      });
      slice = curry$(function(x, y, xs) {
        return xs.slice(x, y);
      });
      take = curry$(function(n, xs) {
        if (n <= 0) {
          return xs.slice(0, 0);
        } else {
          return xs.slice(0, n);
        }
      });
      drop = curry$(function(n, xs) {
        if (n <= 0) {
          return xs;
        } else {
          return xs.slice(n);
        }
      });
      splitAt = curry$(function(n, xs) {
        return [take(n, xs), drop(n, xs)];
      });
      takeWhile = curry$(function(p, xs) {
        var len, i;
        len = xs.length;
        if (!len) {
          return xs;
        }
        i = 0;
        while (i < len && p(xs[i])) {
          i += 1;
        }
        return xs.slice(0, i);
      });
      dropWhile = curry$(function(p, xs) {
        var len, i;
        len = xs.length;
        if (!len) {
          return xs;
        }
        i = 0;
        while (i < len && p(xs[i])) {
          i += 1;
        }
        return xs.slice(i);
      });
      span = curry$(function(p, xs) {
        return [takeWhile(p, xs), dropWhile(p, xs)];
      });
      breakList = curry$(function(p, xs) {
        return span(compose$(p, not$), xs);
      });
      zip = curry$(function(xs, ys) {
        var result, len, i$, len$, i, x;
        result = [];
        len = ys.length;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          i = i$;
          x = xs[i$];
          if (i === len) {
            break;
          }
          result.push([x, ys[i]]);
        }
        return result;
      });
      zipWith = curry$(function(f, xs, ys) {
        var result, len, i$, len$, i, x;
        result = [];
        len = ys.length;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          i = i$;
          x = xs[i$];
          if (i === len) {
            break;
          }
          result.push(f(x, ys[i]));
        }
        return result;
      });
      zipAll = function() {
        var xss, res$, i$, to$, minLength, len$, xs, ref$, i, lresult$, j$, results$ = [];
        res$ = [];
        for (i$ = 0, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        xss = res$;
        minLength = void 0;
        for (i$ = 0, len$ = xss.length; i$ < len$; ++i$) {
          xs = xss[i$];
          minLength <= (ref$ = xs.length) || (minLength = ref$);
        }
        for (i$ = 0; i$ < minLength; ++i$) {
          i = i$;
          lresult$ = [];
          for (j$ = 0, len$ = xss.length; j$ < len$; ++j$) {
            xs = xss[j$];
            lresult$.push(xs[i]);
          }
          results$.push(lresult$);
        }
        return results$;
      };
      zipAllWith = function(f) {
        var xss, res$, i$, to$, minLength, len$, xs, ref$, i, results$ = [];
        res$ = [];
        for (i$ = 1, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        xss = res$;
        minLength = void 0;
        for (i$ = 0, len$ = xss.length; i$ < len$; ++i$) {
          xs = xss[i$];
          minLength <= (ref$ = xs.length) || (minLength = ref$);
        }
        for (i$ = 0; i$ < minLength; ++i$) {
          i = i$;
          results$.push(f.apply(null, fn$()));
        }
        return results$;
        function fn$() {
          var i$2, ref$2, len$2, results$2 = [];
          for (i$2 = 0, len$2 = (ref$2 = xss).length; i$2 < len$2; ++i$2) {
            xs = ref$2[i$2];
            results$2.push(xs[i]);
          }
          return results$2;
        }
      };
      at = curry$(function(n, xs) {
        if (n < 0) {
          return xs[xs.length + n];
        } else {
          return xs[n];
        }
      });
      elemIndex = curry$(function(el, xs) {
        var i$, len$, i, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          i = i$;
          x = xs[i$];
          if (x === el) {
            return i;
          }
        }
      });
      elemIndices = curry$(function(el, xs) {
        var i$, len$, i, x, results$ = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          i = i$;
          x = xs[i$];
          if (x === el) {
            results$.push(i);
          }
        }
        return results$;
      });
      findIndex = curry$(function(f, xs) {
        var i$, len$, i, x;
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          i = i$;
          x = xs[i$];
          if (f(x)) {
            return i;
          }
        }
      });
      findIndices = curry$(function(f, xs) {
        var i$, len$, i, x, results$ = [];
        for (i$ = 0, len$ = xs.length; i$ < len$; ++i$) {
          i = i$;
          x = xs[i$];
          if (f(x)) {
            results$.push(i);
          }
        }
        return results$;
      });
      module.exports = {
        each,
        map,
        filter,
        compact,
        reject,
        remove,
        partition,
        find,
        head,
        first,
        tail,
        last,
        initial,
        empty,
        reverse,
        difference,
        intersection,
        union,
        countBy,
        groupBy,
        fold,
        fold1,
        foldl,
        foldl1,
        foldr,
        foldr1,
        unfoldr,
        andList,
        orList,
        any,
        all,
        unique,
        uniqueBy,
        sort,
        sortWith,
        sortBy,
        sum,
        product,
        mean,
        average,
        concat,
        concatMap,
        flatten,
        maximum,
        minimum,
        maximumBy,
        minimumBy,
        scan,
        scan1,
        scanl,
        scanl1,
        scanr,
        scanr1,
        slice,
        take,
        drop,
        splitAt,
        takeWhile,
        dropWhile,
        span,
        breakList,
        zip,
        zipWith,
        zipAll,
        zipAllWith,
        at,
        elemIndex,
        elemIndices,
        findIndex,
        findIndices
      };
      function curry$(f, bound) {
        var context, _curry = function(args) {
          return f.length > 1 ? function() {
            var params = args ? args.concat() : [];
            context = bound ? context || this : this;
            return params.push.apply(params, arguments) < f.length && arguments.length ? _curry.call(context, params) : f.apply(context, params);
          } : f;
        };
        return _curry();
      }
      function in$(x, xs) {
        var i = -1, l = xs.length >>> 0;
        while (++i < l) if (x === xs[i]) return true;
        return false;
      }
      function compose$() {
        var functions = arguments;
        return function() {
          var i, result;
          result = functions[0].apply(this, arguments);
          for (i = 1; i < functions.length; ++i) {
            result = functions[i](result);
          }
          return result;
        };
      }
      function not$(x) {
        return !x;
      }
    }
  });

  // ../../node_modules/prelude-ls/lib/Obj.js
  var require_Obj = __commonJS({
    "../../node_modules/prelude-ls/lib/Obj.js"(exports, module) {
      init_shim_buffer();
      var values;
      var keys;
      var pairsToObj;
      var objToPairs;
      var listsToObj;
      var objToLists;
      var empty;
      var each;
      var map;
      var compact;
      var filter;
      var reject;
      var partition;
      var find;
      values = function(object) {
        var i$, x, results$ = [];
        for (i$ in object) {
          x = object[i$];
          results$.push(x);
        }
        return results$;
      };
      keys = function(object) {
        var x, results$ = [];
        for (x in object) {
          results$.push(x);
        }
        return results$;
      };
      pairsToObj = function(object) {
        var i$, len$, x, resultObj$ = {};
        for (i$ = 0, len$ = object.length; i$ < len$; ++i$) {
          x = object[i$];
          resultObj$[x[0]] = x[1];
        }
        return resultObj$;
      };
      objToPairs = function(object) {
        var key, value, results$ = [];
        for (key in object) {
          value = object[key];
          results$.push([key, value]);
        }
        return results$;
      };
      listsToObj = curry$(function(keys2, values2) {
        var i$, len$, i, key, resultObj$ = {};
        for (i$ = 0, len$ = keys2.length; i$ < len$; ++i$) {
          i = i$;
          key = keys2[i$];
          resultObj$[key] = values2[i];
        }
        return resultObj$;
      });
      objToLists = function(object) {
        var keys2, values2, key, value;
        keys2 = [];
        values2 = [];
        for (key in object) {
          value = object[key];
          keys2.push(key);
          values2.push(value);
        }
        return [keys2, values2];
      };
      empty = function(object) {
        var x;
        for (x in object) {
          return false;
        }
        return true;
      };
      each = curry$(function(f, object) {
        var i$, x;
        for (i$ in object) {
          x = object[i$];
          f(x);
        }
        return object;
      });
      map = curry$(function(f, object) {
        var k, x, resultObj$ = {};
        for (k in object) {
          x = object[k];
          resultObj$[k] = f(x);
        }
        return resultObj$;
      });
      compact = function(object) {
        var k, x, resultObj$ = {};
        for (k in object) {
          x = object[k];
          if (x) {
            resultObj$[k] = x;
          }
        }
        return resultObj$;
      };
      filter = curry$(function(f, object) {
        var k, x, resultObj$ = {};
        for (k in object) {
          x = object[k];
          if (f(x)) {
            resultObj$[k] = x;
          }
        }
        return resultObj$;
      });
      reject = curry$(function(f, object) {
        var k, x, resultObj$ = {};
        for (k in object) {
          x = object[k];
          if (!f(x)) {
            resultObj$[k] = x;
          }
        }
        return resultObj$;
      });
      partition = curry$(function(f, object) {
        var passed, failed, k, x;
        passed = {};
        failed = {};
        for (k in object) {
          x = object[k];
          (f(x) ? passed : failed)[k] = x;
        }
        return [passed, failed];
      });
      find = curry$(function(f, object) {
        var i$, x;
        for (i$ in object) {
          x = object[i$];
          if (f(x)) {
            return x;
          }
        }
      });
      module.exports = {
        values,
        keys,
        pairsToObj,
        objToPairs,
        listsToObj,
        objToLists,
        empty,
        each,
        map,
        filter,
        compact,
        reject,
        partition,
        find
      };
      function curry$(f, bound) {
        var context, _curry = function(args) {
          return f.length > 1 ? function() {
            var params = args ? args.concat() : [];
            context = bound ? context || this : this;
            return params.push.apply(params, arguments) < f.length && arguments.length ? _curry.call(context, params) : f.apply(context, params);
          } : f;
        };
        return _curry();
      }
    }
  });

  // ../../node_modules/prelude-ls/lib/Str.js
  var require_Str = __commonJS({
    "../../node_modules/prelude-ls/lib/Str.js"(exports, module) {
      init_shim_buffer();
      var split;
      var join;
      var lines;
      var unlines;
      var words;
      var unwords;
      var chars;
      var unchars;
      var reverse;
      var repeat;
      var capitalize;
      var camelize;
      var dasherize;
      split = curry$(function(sep, str) {
        return str.split(sep);
      });
      join = curry$(function(sep, xs) {
        return xs.join(sep);
      });
      lines = function(str) {
        if (!str.length) {
          return [];
        }
        return str.split("\n");
      };
      unlines = function(it) {
        return it.join("\n");
      };
      words = function(str) {
        if (!str.length) {
          return [];
        }
        return str.split(/[ ]+/);
      };
      unwords = function(it) {
        return it.join(" ");
      };
      chars = function(it) {
        return it.split("");
      };
      unchars = function(it) {
        return it.join("");
      };
      reverse = function(str) {
        return str.split("").reverse().join("");
      };
      repeat = curry$(function(n, str) {
        var result, i$;
        result = "";
        for (i$ = 0; i$ < n; ++i$) {
          result += str;
        }
        return result;
      });
      capitalize = function(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
      };
      camelize = function(it) {
        return it.replace(/[-_]+(.)?/g, function(arg$, c) {
          return (c != null ? c : "").toUpperCase();
        });
      };
      dasherize = function(str) {
        return str.replace(/([^-A-Z])([A-Z]+)/g, function(arg$, lower, upper) {
          return lower + "-" + (upper.length > 1 ? upper : upper.toLowerCase());
        }).replace(/^([A-Z]+)/, function(arg$, upper) {
          if (upper.length > 1) {
            return upper + "-";
          } else {
            return upper.toLowerCase();
          }
        });
      };
      module.exports = {
        split,
        join,
        lines,
        unlines,
        words,
        unwords,
        chars,
        unchars,
        reverse,
        repeat,
        capitalize,
        camelize,
        dasherize
      };
      function curry$(f, bound) {
        var context, _curry = function(args) {
          return f.length > 1 ? function() {
            var params = args ? args.concat() : [];
            context = bound ? context || this : this;
            return params.push.apply(params, arguments) < f.length && arguments.length ? _curry.call(context, params) : f.apply(context, params);
          } : f;
        };
        return _curry();
      }
    }
  });

  // ../../node_modules/prelude-ls/lib/Num.js
  var require_Num = __commonJS({
    "../../node_modules/prelude-ls/lib/Num.js"(exports, module) {
      init_shim_buffer();
      var max;
      var min;
      var negate;
      var abs;
      var signum;
      var quot;
      var rem;
      var div;
      var mod;
      var recip;
      var pi;
      var tau;
      var exp;
      var sqrt;
      var ln;
      var pow;
      var sin;
      var tan;
      var cos;
      var asin;
      var acos;
      var atan;
      var atan2;
      var truncate;
      var round;
      var ceiling;
      var floor;
      var isItNaN;
      var even;
      var odd;
      var gcd;
      var lcm;
      max = curry$(function(x$, y$) {
        return x$ > y$ ? x$ : y$;
      });
      min = curry$(function(x$, y$) {
        return x$ < y$ ? x$ : y$;
      });
      negate = function(x) {
        return -x;
      };
      abs = Math.abs;
      signum = function(x) {
        if (x < 0) {
          return -1;
        } else if (x > 0) {
          return 1;
        } else {
          return 0;
        }
      };
      quot = curry$(function(x, y) {
        return ~~(x / y);
      });
      rem = curry$(function(x$, y$) {
        return x$ % y$;
      });
      div = curry$(function(x, y) {
        return Math.floor(x / y);
      });
      mod = curry$(function(x$, y$) {
        var ref$;
        return (x$ % (ref$ = y$) + ref$) % ref$;
      });
      recip = (function(it) {
        return 1 / it;
      });
      pi = Math.PI;
      tau = pi * 2;
      exp = Math.exp;
      sqrt = Math.sqrt;
      ln = Math.log;
      pow = curry$(function(x$, y$) {
        return Math.pow(x$, y$);
      });
      sin = Math.sin;
      tan = Math.tan;
      cos = Math.cos;
      asin = Math.asin;
      acos = Math.acos;
      atan = Math.atan;
      atan2 = curry$(function(x, y) {
        return Math.atan2(x, y);
      });
      truncate = function(x) {
        return ~~x;
      };
      round = Math.round;
      ceiling = Math.ceil;
      floor = Math.floor;
      isItNaN = function(x) {
        return x !== x;
      };
      even = function(x) {
        return x % 2 === 0;
      };
      odd = function(x) {
        return x % 2 !== 0;
      };
      gcd = curry$(function(x, y) {
        var z;
        x = Math.abs(x);
        y = Math.abs(y);
        while (y !== 0) {
          z = x % y;
          x = y;
          y = z;
        }
        return x;
      });
      lcm = curry$(function(x, y) {
        return Math.abs(Math.floor(x / gcd(x, y) * y));
      });
      module.exports = {
        max,
        min,
        negate,
        abs,
        signum,
        quot,
        rem,
        div,
        mod,
        recip,
        pi,
        tau,
        exp,
        sqrt,
        ln,
        pow,
        sin,
        tan,
        cos,
        acos,
        asin,
        atan,
        atan2,
        truncate,
        round,
        ceiling,
        floor,
        isItNaN,
        even,
        odd,
        gcd,
        lcm
      };
      function curry$(f, bound) {
        var context, _curry = function(args) {
          return f.length > 1 ? function() {
            var params = args ? args.concat() : [];
            context = bound ? context || this : this;
            return params.push.apply(params, arguments) < f.length && arguments.length ? _curry.call(context, params) : f.apply(context, params);
          } : f;
        };
        return _curry();
      }
    }
  });

  // ../../node_modules/prelude-ls/lib/index.js
  var require_lib = __commonJS({
    "../../node_modules/prelude-ls/lib/index.js"(exports, module) {
      init_shim_buffer();
      var Func;
      var List;
      var Obj;
      var Str;
      var Num;
      var id;
      var isType;
      var replicate;
      var prelude;
      var toString$ = {}.toString;
      Func = require_Func();
      List = require_List();
      Obj = require_Obj();
      Str = require_Str();
      Num = require_Num();
      id = function(x) {
        return x;
      };
      isType = curry$(function(type, x) {
        return toString$.call(x).slice(8, -1) === type;
      });
      replicate = curry$(function(n, x) {
        var i$, results$ = [];
        for (i$ = 0; i$ < n; ++i$) {
          results$.push(x);
        }
        return results$;
      });
      Str.empty = List.empty;
      Str.slice = List.slice;
      Str.take = List.take;
      Str.drop = List.drop;
      Str.splitAt = List.splitAt;
      Str.takeWhile = List.takeWhile;
      Str.dropWhile = List.dropWhile;
      Str.span = List.span;
      Str.breakStr = List.breakList;
      prelude = {
        Func,
        List,
        Obj,
        Str,
        Num,
        id,
        isType,
        replicate
      };
      prelude.each = List.each;
      prelude.map = List.map;
      prelude.filter = List.filter;
      prelude.compact = List.compact;
      prelude.reject = List.reject;
      prelude.partition = List.partition;
      prelude.find = List.find;
      prelude.head = List.head;
      prelude.first = List.first;
      prelude.tail = List.tail;
      prelude.last = List.last;
      prelude.initial = List.initial;
      prelude.empty = List.empty;
      prelude.reverse = List.reverse;
      prelude.difference = List.difference;
      prelude.intersection = List.intersection;
      prelude.union = List.union;
      prelude.countBy = List.countBy;
      prelude.groupBy = List.groupBy;
      prelude.fold = List.fold;
      prelude.foldl = List.foldl;
      prelude.fold1 = List.fold1;
      prelude.foldl1 = List.foldl1;
      prelude.foldr = List.foldr;
      prelude.foldr1 = List.foldr1;
      prelude.unfoldr = List.unfoldr;
      prelude.andList = List.andList;
      prelude.orList = List.orList;
      prelude.any = List.any;
      prelude.all = List.all;
      prelude.unique = List.unique;
      prelude.uniqueBy = List.uniqueBy;
      prelude.sort = List.sort;
      prelude.sortWith = List.sortWith;
      prelude.sortBy = List.sortBy;
      prelude.sum = List.sum;
      prelude.product = List.product;
      prelude.mean = List.mean;
      prelude.average = List.average;
      prelude.concat = List.concat;
      prelude.concatMap = List.concatMap;
      prelude.flatten = List.flatten;
      prelude.maximum = List.maximum;
      prelude.minimum = List.minimum;
      prelude.maximumBy = List.maximumBy;
      prelude.minimumBy = List.minimumBy;
      prelude.scan = List.scan;
      prelude.scanl = List.scanl;
      prelude.scan1 = List.scan1;
      prelude.scanl1 = List.scanl1;
      prelude.scanr = List.scanr;
      prelude.scanr1 = List.scanr1;
      prelude.slice = List.slice;
      prelude.take = List.take;
      prelude.drop = List.drop;
      prelude.splitAt = List.splitAt;
      prelude.takeWhile = List.takeWhile;
      prelude.dropWhile = List.dropWhile;
      prelude.span = List.span;
      prelude.breakList = List.breakList;
      prelude.zip = List.zip;
      prelude.zipWith = List.zipWith;
      prelude.zipAll = List.zipAll;
      prelude.zipAllWith = List.zipAllWith;
      prelude.at = List.at;
      prelude.elemIndex = List.elemIndex;
      prelude.elemIndices = List.elemIndices;
      prelude.findIndex = List.findIndex;
      prelude.findIndices = List.findIndices;
      prelude.apply = Func.apply;
      prelude.curry = Func.curry;
      prelude.flip = Func.flip;
      prelude.fix = Func.fix;
      prelude.over = Func.over;
      prelude.split = Str.split;
      prelude.join = Str.join;
      prelude.lines = Str.lines;
      prelude.unlines = Str.unlines;
      prelude.words = Str.words;
      prelude.unwords = Str.unwords;
      prelude.chars = Str.chars;
      prelude.unchars = Str.unchars;
      prelude.repeat = Str.repeat;
      prelude.capitalize = Str.capitalize;
      prelude.camelize = Str.camelize;
      prelude.dasherize = Str.dasherize;
      prelude.values = Obj.values;
      prelude.keys = Obj.keys;
      prelude.pairsToObj = Obj.pairsToObj;
      prelude.objToPairs = Obj.objToPairs;
      prelude.listsToObj = Obj.listsToObj;
      prelude.objToLists = Obj.objToLists;
      prelude.max = Num.max;
      prelude.min = Num.min;
      prelude.negate = Num.negate;
      prelude.abs = Num.abs;
      prelude.signum = Num.signum;
      prelude.quot = Num.quot;
      prelude.rem = Num.rem;
      prelude.div = Num.div;
      prelude.mod = Num.mod;
      prelude.recip = Num.recip;
      prelude.pi = Num.pi;
      prelude.tau = Num.tau;
      prelude.exp = Num.exp;
      prelude.sqrt = Num.sqrt;
      prelude.ln = Num.ln;
      prelude.pow = Num.pow;
      prelude.sin = Num.sin;
      prelude.tan = Num.tan;
      prelude.cos = Num.cos;
      prelude.acos = Num.acos;
      prelude.asin = Num.asin;
      prelude.atan = Num.atan;
      prelude.atan2 = Num.atan2;
      prelude.truncate = Num.truncate;
      prelude.round = Num.round;
      prelude.ceiling = Num.ceiling;
      prelude.floor = Num.floor;
      prelude.isItNaN = Num.isItNaN;
      prelude.even = Num.even;
      prelude.odd = Num.odd;
      prelude.gcd = Num.gcd;
      prelude.lcm = Num.lcm;
      prelude.VERSION = "1.2.1";
      module.exports = prelude;
      function curry$(f, bound) {
        var context, _curry = function(args) {
          return f.length > 1 ? function() {
            var params = args ? args.concat() : [];
            context = bound ? context || this : this;
            return params.push.apply(params, arguments) < f.length && arguments.length ? _curry.call(context, params) : f.apply(context, params);
          } : f;
        };
        return _curry();
      }
    }
  });

  // lib/util.js
  var require_util = __commonJS({
    "lib/util.js"(exports, module) {
      init_shim_buffer();
      var path;
      var stripString;
      var nameFromPath;
      path = require_stub_path();
      stripString = function(val) {
        var that;
        if (that = /^['"](.*)['"]$/.exec(val.trim())) {
          return that[1];
        } else {
          return val;
        }
      };
      nameFromPath = function(modulePath) {
        return path.basename(stripString(modulePath)).split(".")[0].replace(/-[a-z]/ig, function(it) {
          return it.charAt(1).toUpperCase();
        });
      };
      module.exports = {
        nameFromPath,
        stripString
      };
    }
  });

  // ../../node_modules/source-map/lib/base64.js
  var require_base64 = __commonJS({
    "../../node_modules/source-map/lib/base64.js"(exports) {
      init_shim_buffer();
      var intToCharMap = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
      exports.encode = function(number) {
        if (0 <= number && number < intToCharMap.length) {
          return intToCharMap[number];
        }
        throw new TypeError("Must be between 0 and 63: " + number);
      };
    }
  });

  // ../../node_modules/source-map/lib/base64-vlq.js
  var require_base64_vlq = __commonJS({
    "../../node_modules/source-map/lib/base64-vlq.js"(exports) {
      init_shim_buffer();
      var base64 = require_base64();
      var VLQ_BASE_SHIFT = 5;
      var VLQ_BASE = 1 << VLQ_BASE_SHIFT;
      var VLQ_BASE_MASK = VLQ_BASE - 1;
      var VLQ_CONTINUATION_BIT = VLQ_BASE;
      function toVLQSigned(aValue) {
        return aValue < 0 ? (-aValue << 1) + 1 : (aValue << 1) + 0;
      }
      exports.encode = function base64VLQ_encode(aValue) {
        let encoded = "";
        let digit;
        let vlq = toVLQSigned(aValue);
        do {
          digit = vlq & VLQ_BASE_MASK;
          vlq >>>= VLQ_BASE_SHIFT;
          if (vlq > 0) {
            digit |= VLQ_CONTINUATION_BIT;
          }
          encoded += base64.encode(digit);
        } while (vlq > 0);
        return encoded;
      };
    }
  });

  // ../../node_modules/source-map/lib/util.js
  var require_util2 = __commonJS({
    "../../node_modules/source-map/lib/util.js"(exports) {
      init_shim_buffer();
      function getArg(aArgs, aName, aDefaultValue) {
        if (aName in aArgs) {
          return aArgs[aName];
        } else if (arguments.length === 3) {
          return aDefaultValue;
        }
        throw new Error('"' + aName + '" is a required argument.');
      }
      exports.getArg = getArg;
      var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.-]*)(?::(\d+))?(.*)$/;
      var dataUrlRegexp = /^data:.+\,.+$/;
      function urlParse(aUrl) {
        const match = aUrl.match(urlRegexp);
        if (!match) {
          return null;
        }
        return {
          scheme: match[1],
          auth: match[2],
          host: match[3],
          port: match[4],
          path: match[5]
        };
      }
      exports.urlParse = urlParse;
      function urlGenerate(aParsedUrl) {
        let url = "";
        if (aParsedUrl.scheme) {
          url += aParsedUrl.scheme + ":";
        }
        url += "//";
        if (aParsedUrl.auth) {
          url += aParsedUrl.auth + "@";
        }
        if (aParsedUrl.host) {
          url += aParsedUrl.host;
        }
        if (aParsedUrl.port) {
          url += ":" + aParsedUrl.port;
        }
        if (aParsedUrl.path) {
          url += aParsedUrl.path;
        }
        return url;
      }
      exports.urlGenerate = urlGenerate;
      var MAX_CACHED_INPUTS = 32;
      function lruMemoize(f) {
        const cache = [];
        return function(input) {
          for (let i = 0; i < cache.length; i++) {
            if (cache[i].input === input) {
              const temp = cache[0];
              cache[0] = cache[i];
              cache[i] = temp;
              return cache[0].result;
            }
          }
          const result = f(input);
          cache.unshift({
            input,
            result
          });
          if (cache.length > MAX_CACHED_INPUTS) {
            cache.pop();
          }
          return result;
        };
      }
      var normalize = lruMemoize(function normalize2(aPath) {
        let path = aPath;
        const url = urlParse(aPath);
        if (url) {
          if (!url.path) {
            return aPath;
          }
          path = url.path;
        }
        const isAbsolute = exports.isAbsolute(path);
        const parts = [];
        let start = 0;
        let i = 0;
        while (true) {
          start = i;
          i = path.indexOf("/", start);
          if (i === -1) {
            parts.push(path.slice(start));
            break;
          } else {
            parts.push(path.slice(start, i));
            while (i < path.length && path[i] === "/") {
              i++;
            }
          }
        }
        let up = 0;
        for (i = parts.length - 1; i >= 0; i--) {
          const part = parts[i];
          if (part === ".") {
            parts.splice(i, 1);
          } else if (part === "..") {
            up++;
          } else if (up > 0) {
            if (part === "") {
              parts.splice(i + 1, up);
              up = 0;
            } else {
              parts.splice(i, 2);
              up--;
            }
          }
        }
        path = parts.join("/");
        if (path === "") {
          path = isAbsolute ? "/" : ".";
        }
        if (url) {
          url.path = path;
          return urlGenerate(url);
        }
        return path;
      });
      exports.normalize = normalize;
      function join(aRoot, aPath) {
        if (aRoot === "") {
          aRoot = ".";
        }
        if (aPath === "") {
          aPath = ".";
        }
        const aPathUrl = urlParse(aPath);
        const aRootUrl = urlParse(aRoot);
        if (aRootUrl) {
          aRoot = aRootUrl.path || "/";
        }
        if (aPathUrl && !aPathUrl.scheme) {
          if (aRootUrl) {
            aPathUrl.scheme = aRootUrl.scheme;
          }
          return urlGenerate(aPathUrl);
        }
        if (aPathUrl || aPath.match(dataUrlRegexp)) {
          return aPath;
        }
        if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
          aRootUrl.host = aPath;
          return urlGenerate(aRootUrl);
        }
        const joined = aPath.charAt(0) === "/" ? aPath : normalize(aRoot.replace(/\/+$/, "") + "/" + aPath);
        if (aRootUrl) {
          aRootUrl.path = joined;
          return urlGenerate(aRootUrl);
        }
        return joined;
      }
      exports.join = join;
      exports.isAbsolute = function(aPath) {
        return aPath.charAt(0) === "/" || urlRegexp.test(aPath);
      };
      function relative(aRoot, aPath) {
        if (aRoot === "") {
          aRoot = ".";
        }
        aRoot = aRoot.replace(/\/$/, "");
        let level = 0;
        while (aPath.indexOf(aRoot + "/") !== 0) {
          const index = aRoot.lastIndexOf("/");
          if (index < 0) {
            return aPath;
          }
          aRoot = aRoot.slice(0, index);
          if (aRoot.match(/^([^\/]+:\/)?\/*$/)) {
            return aPath;
          }
          ++level;
        }
        return Array(level + 1).join("../") + aPath.substr(aRoot.length + 1);
      }
      exports.relative = relative;
      var supportsNullProto = (function() {
        const obj = /* @__PURE__ */ Object.create(null);
        return !("__proto__" in obj);
      })();
      function identity(s) {
        return s;
      }
      function toSetString(aStr) {
        if (isProtoString(aStr)) {
          return "$" + aStr;
        }
        return aStr;
      }
      exports.toSetString = supportsNullProto ? identity : toSetString;
      function fromSetString(aStr) {
        if (isProtoString(aStr)) {
          return aStr.slice(1);
        }
        return aStr;
      }
      exports.fromSetString = supportsNullProto ? identity : fromSetString;
      function isProtoString(s) {
        if (!s) {
          return false;
        }
        const length = s.length;
        if (length < 9) {
          return false;
        }
        if (s.charCodeAt(length - 1) !== 95 || s.charCodeAt(length - 2) !== 95 || s.charCodeAt(length - 3) !== 111 || s.charCodeAt(length - 4) !== 116 || s.charCodeAt(length - 5) !== 111 || s.charCodeAt(length - 6) !== 114 || s.charCodeAt(length - 7) !== 112 || s.charCodeAt(length - 8) !== 95 || s.charCodeAt(length - 9) !== 95) {
          return false;
        }
        for (let i = length - 10; i >= 0; i--) {
          if (s.charCodeAt(i) !== 36) {
            return false;
          }
        }
        return true;
      }
      function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
        let cmp = strcmp(mappingA.source, mappingB.source);
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.originalLine - mappingB.originalLine;
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.originalColumn - mappingB.originalColumn;
        if (cmp !== 0 || onlyCompareOriginal) {
          return cmp;
        }
        cmp = mappingA.generatedColumn - mappingB.generatedColumn;
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.generatedLine - mappingB.generatedLine;
        if (cmp !== 0) {
          return cmp;
        }
        return strcmp(mappingA.name, mappingB.name);
      }
      exports.compareByOriginalPositions = compareByOriginalPositions;
      function compareByGeneratedPositionsDeflated(mappingA, mappingB, onlyCompareGenerated) {
        let cmp = mappingA.generatedLine - mappingB.generatedLine;
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.generatedColumn - mappingB.generatedColumn;
        if (cmp !== 0 || onlyCompareGenerated) {
          return cmp;
        }
        cmp = strcmp(mappingA.source, mappingB.source);
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.originalLine - mappingB.originalLine;
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.originalColumn - mappingB.originalColumn;
        if (cmp !== 0) {
          return cmp;
        }
        return strcmp(mappingA.name, mappingB.name);
      }
      exports.compareByGeneratedPositionsDeflated = compareByGeneratedPositionsDeflated;
      function strcmp(aStr1, aStr2) {
        if (aStr1 === aStr2) {
          return 0;
        }
        if (aStr1 === null) {
          return 1;
        }
        if (aStr2 === null) {
          return -1;
        }
        if (aStr1 > aStr2) {
          return 1;
        }
        return -1;
      }
      function compareByGeneratedPositionsInflated(mappingA, mappingB) {
        let cmp = mappingA.generatedLine - mappingB.generatedLine;
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.generatedColumn - mappingB.generatedColumn;
        if (cmp !== 0) {
          return cmp;
        }
        cmp = strcmp(mappingA.source, mappingB.source);
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.originalLine - mappingB.originalLine;
        if (cmp !== 0) {
          return cmp;
        }
        cmp = mappingA.originalColumn - mappingB.originalColumn;
        if (cmp !== 0) {
          return cmp;
        }
        return strcmp(mappingA.name, mappingB.name);
      }
      exports.compareByGeneratedPositionsInflated = compareByGeneratedPositionsInflated;
      function parseSourceMapInput(str) {
        return JSON.parse(str.replace(/^\)]}'[^\n]*\n/, ""));
      }
      exports.parseSourceMapInput = parseSourceMapInput;
      function computeSourceURL(sourceRoot, sourceURL, sourceMapURL) {
        sourceURL = sourceURL || "";
        if (sourceRoot) {
          if (sourceRoot[sourceRoot.length - 1] !== "/" && sourceURL[0] !== "/") {
            sourceRoot += "/";
          }
          sourceURL = sourceRoot + sourceURL;
        }
        if (sourceMapURL) {
          const parsed = urlParse(sourceMapURL);
          if (!parsed) {
            throw new Error("sourceMapURL could not be parsed");
          }
          if (parsed.path) {
            const index = parsed.path.lastIndexOf("/");
            if (index >= 0) {
              parsed.path = parsed.path.substring(0, index + 1);
            }
          }
          sourceURL = join(urlGenerate(parsed), sourceURL);
        }
        return normalize(sourceURL);
      }
      exports.computeSourceURL = computeSourceURL;
    }
  });

  // ../../node_modules/source-map/lib/array-set.js
  var require_array_set = __commonJS({
    "../../node_modules/source-map/lib/array-set.js"(exports) {
      init_shim_buffer();
      var ArraySet = class _ArraySet {
        constructor() {
          this._array = [];
          this._set = /* @__PURE__ */ new Map();
        }
        /**
         * Static method for creating ArraySet instances from an existing array.
         */
        static fromArray(aArray, aAllowDuplicates) {
          const set = new _ArraySet();
          for (let i = 0, len = aArray.length; i < len; i++) {
            set.add(aArray[i], aAllowDuplicates);
          }
          return set;
        }
        /**
         * Return how many unique items are in this ArraySet. If duplicates have been
         * added, than those do not count towards the size.
         *
         * @returns Number
         */
        size() {
          return this._set.size;
        }
        /**
         * Add the given string to this set.
         *
         * @param String aStr
         */
        add(aStr, aAllowDuplicates) {
          const isDuplicate = this.has(aStr);
          const idx = this._array.length;
          if (!isDuplicate || aAllowDuplicates) {
            this._array.push(aStr);
          }
          if (!isDuplicate) {
            this._set.set(aStr, idx);
          }
        }
        /**
         * Is the given string a member of this set?
         *
         * @param String aStr
         */
        has(aStr) {
          return this._set.has(aStr);
        }
        /**
         * What is the index of the given string in the array?
         *
         * @param String aStr
         */
        indexOf(aStr) {
          const idx = this._set.get(aStr);
          if (idx >= 0) {
            return idx;
          }
          throw new Error('"' + aStr + '" is not in the set.');
        }
        /**
         * What is the element at the given index?
         *
         * @param Number aIdx
         */
        at(aIdx) {
          if (aIdx >= 0 && aIdx < this._array.length) {
            return this._array[aIdx];
          }
          throw new Error("No element indexed by " + aIdx);
        }
        /**
         * Returns the array representation of this set (which has the proper indices
         * indicated by indexOf). Note that this is a copy of the internal array used
         * for storing the members so that no one can mess with internal state.
         */
        toArray() {
          return this._array.slice();
        }
      };
      exports.ArraySet = ArraySet;
    }
  });

  // ../../node_modules/source-map/lib/mapping-list.js
  var require_mapping_list = __commonJS({
    "../../node_modules/source-map/lib/mapping-list.js"(exports) {
      init_shim_buffer();
      var util = require_util2();
      function generatedPositionAfter(mappingA, mappingB) {
        const lineA = mappingA.generatedLine;
        const lineB = mappingB.generatedLine;
        const columnA = mappingA.generatedColumn;
        const columnB = mappingB.generatedColumn;
        return lineB > lineA || lineB == lineA && columnB >= columnA || util.compareByGeneratedPositionsInflated(mappingA, mappingB) <= 0;
      }
      var MappingList = class {
        constructor() {
          this._array = [];
          this._sorted = true;
          this._last = { generatedLine: -1, generatedColumn: 0 };
        }
        /**
         * Iterate through internal items. This method takes the same arguments that
         * `Array.prototype.forEach` takes.
         *
         * NOTE: The order of the mappings is NOT guaranteed.
         */
        unsortedForEach(aCallback, aThisArg) {
          this._array.forEach(aCallback, aThisArg);
        }
        /**
         * Add the given source mapping.
         *
         * @param Object aMapping
         */
        add(aMapping) {
          if (generatedPositionAfter(this._last, aMapping)) {
            this._last = aMapping;
            this._array.push(aMapping);
          } else {
            this._sorted = false;
            this._array.push(aMapping);
          }
        }
        /**
         * Returns the flat, sorted array of mappings. The mappings are sorted by
         * generated position.
         *
         * WARNING: This method returns internal data without copying, for
         * performance. The return value must NOT be mutated, and should be treated as
         * an immutable borrow. If you want to take ownership, you must make your own
         * copy.
         */
        toArray() {
          if (!this._sorted) {
            this._array.sort(util.compareByGeneratedPositionsInflated);
            this._sorted = true;
          }
          return this._array;
        }
      };
      exports.MappingList = MappingList;
    }
  });

  // ../../node_modules/source-map/lib/source-map-generator.js
  var require_source_map_generator = __commonJS({
    "../../node_modules/source-map/lib/source-map-generator.js"(exports) {
      init_shim_buffer();
      var base64VLQ = require_base64_vlq();
      var util = require_util2();
      var ArraySet = require_array_set().ArraySet;
      var MappingList = require_mapping_list().MappingList;
      var SourceMapGenerator = class _SourceMapGenerator {
        constructor(aArgs) {
          if (!aArgs) {
            aArgs = {};
          }
          this._file = util.getArg(aArgs, "file", null);
          this._sourceRoot = util.getArg(aArgs, "sourceRoot", null);
          this._skipValidation = util.getArg(aArgs, "skipValidation", false);
          this._sources = new ArraySet();
          this._names = new ArraySet();
          this._mappings = new MappingList();
          this._sourcesContents = null;
        }
        /**
         * Creates a new SourceMapGenerator based on a SourceMapConsumer
         *
         * @param aSourceMapConsumer The SourceMap.
         */
        static fromSourceMap(aSourceMapConsumer) {
          const sourceRoot = aSourceMapConsumer.sourceRoot;
          const generator = new _SourceMapGenerator({
            file: aSourceMapConsumer.file,
            sourceRoot
          });
          aSourceMapConsumer.eachMapping(function(mapping) {
            const newMapping = {
              generated: {
                line: mapping.generatedLine,
                column: mapping.generatedColumn
              }
            };
            if (mapping.source != null) {
              newMapping.source = mapping.source;
              if (sourceRoot != null) {
                newMapping.source = util.relative(sourceRoot, newMapping.source);
              }
              newMapping.original = {
                line: mapping.originalLine,
                column: mapping.originalColumn
              };
              if (mapping.name != null) {
                newMapping.name = mapping.name;
              }
            }
            generator.addMapping(newMapping);
          });
          aSourceMapConsumer.sources.forEach(function(sourceFile) {
            let sourceRelative = sourceFile;
            if (sourceRoot !== null) {
              sourceRelative = util.relative(sourceRoot, sourceFile);
            }
            if (!generator._sources.has(sourceRelative)) {
              generator._sources.add(sourceRelative);
            }
            const content = aSourceMapConsumer.sourceContentFor(sourceFile);
            if (content != null) {
              generator.setSourceContent(sourceFile, content);
            }
          });
          return generator;
        }
        /**
         * Add a single mapping from original source line and column to the generated
         * source's line and column for this source map being created. The mapping
         * object should have the following properties:
         *
         *   - generated: An object with the generated line and column positions.
         *   - original: An object with the original line and column positions.
         *   - source: The original source file (relative to the sourceRoot).
         *   - name: An optional original token name for this mapping.
         */
        addMapping(aArgs) {
          const generated = util.getArg(aArgs, "generated");
          const original = util.getArg(aArgs, "original", null);
          let source = util.getArg(aArgs, "source", null);
          let name = util.getArg(aArgs, "name", null);
          if (!this._skipValidation) {
            this._validateMapping(generated, original, source, name);
          }
          if (source != null) {
            source = String(source);
            if (!this._sources.has(source)) {
              this._sources.add(source);
            }
          }
          if (name != null) {
            name = String(name);
            if (!this._names.has(name)) {
              this._names.add(name);
            }
          }
          this._mappings.add({
            generatedLine: generated.line,
            generatedColumn: generated.column,
            originalLine: original != null && original.line,
            originalColumn: original != null && original.column,
            source,
            name
          });
        }
        /**
         * Set the source content for a source file.
         */
        setSourceContent(aSourceFile, aSourceContent) {
          let source = aSourceFile;
          if (this._sourceRoot != null) {
            source = util.relative(this._sourceRoot, source);
          }
          if (aSourceContent != null) {
            if (!this._sourcesContents) {
              this._sourcesContents = /* @__PURE__ */ Object.create(null);
            }
            this._sourcesContents[util.toSetString(source)] = aSourceContent;
          } else if (this._sourcesContents) {
            delete this._sourcesContents[util.toSetString(source)];
            if (Object.keys(this._sourcesContents).length === 0) {
              this._sourcesContents = null;
            }
          }
        }
        /**
         * Applies the mappings of a sub-source-map for a specific source file to the
         * source map being generated. Each mapping to the supplied source file is
         * rewritten using the supplied source map. Note: The resolution for the
         * resulting mappings is the minimium of this map and the supplied map.
         *
         * @param aSourceMapConsumer The source map to be applied.
         * @param aSourceFile Optional. The filename of the source file.
         *        If omitted, SourceMapConsumer's file property will be used.
         * @param aSourceMapPath Optional. The dirname of the path to the source map
         *        to be applied. If relative, it is relative to the SourceMapConsumer.
         *        This parameter is needed when the two source maps aren't in the same
         *        directory, and the source map to be applied contains relative source
         *        paths. If so, those relative source paths need to be rewritten
         *        relative to the SourceMapGenerator.
         */
        applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
          let sourceFile = aSourceFile;
          if (aSourceFile == null) {
            if (aSourceMapConsumer.file == null) {
              throw new Error(
                `SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, or the source map's "file" property. Both were omitted.`
              );
            }
            sourceFile = aSourceMapConsumer.file;
          }
          const sourceRoot = this._sourceRoot;
          if (sourceRoot != null) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          const newSources = this._mappings.toArray().length > 0 ? new ArraySet() : this._sources;
          const newNames = new ArraySet();
          this._mappings.unsortedForEach(function(mapping) {
            if (mapping.source === sourceFile && mapping.originalLine != null) {
              const original = aSourceMapConsumer.originalPositionFor({
                line: mapping.originalLine,
                column: mapping.originalColumn
              });
              if (original.source != null) {
                mapping.source = original.source;
                if (aSourceMapPath != null) {
                  mapping.source = util.join(aSourceMapPath, mapping.source);
                }
                if (sourceRoot != null) {
                  mapping.source = util.relative(sourceRoot, mapping.source);
                }
                mapping.originalLine = original.line;
                mapping.originalColumn = original.column;
                if (original.name != null) {
                  mapping.name = original.name;
                }
              }
            }
            const source = mapping.source;
            if (source != null && !newSources.has(source)) {
              newSources.add(source);
            }
            const name = mapping.name;
            if (name != null && !newNames.has(name)) {
              newNames.add(name);
            }
          }, this);
          this._sources = newSources;
          this._names = newNames;
          aSourceMapConsumer.sources.forEach(function(srcFile) {
            const content = aSourceMapConsumer.sourceContentFor(srcFile);
            if (content != null) {
              if (aSourceMapPath != null) {
                srcFile = util.join(aSourceMapPath, srcFile);
              }
              if (sourceRoot != null) {
                srcFile = util.relative(sourceRoot, srcFile);
              }
              this.setSourceContent(srcFile, content);
            }
          }, this);
        }
        /**
         * A mapping can have one of the three levels of data:
         *
         *   1. Just the generated position.
         *   2. The Generated position, original position, and original source.
         *   3. Generated and original position, original source, as well as a name
         *      token.
         *
         * To maintain consistency, we validate that any new mapping being added falls
         * in to one of these categories.
         */
        _validateMapping(aGenerated, aOriginal, aSource, aName) {
          if (aOriginal && typeof aOriginal.line !== "number" && typeof aOriginal.column !== "number") {
            throw new Error(
              "original.line and original.column are not numbers -- you probably meant to omit the original mapping entirely and only map the generated position. If so, pass null for the original mapping instead of an object with empty or null values."
            );
          }
          if (aGenerated && "line" in aGenerated && "column" in aGenerated && aGenerated.line > 0 && aGenerated.column >= 0 && !aOriginal && !aSource && !aName) {
          } else if (aGenerated && "line" in aGenerated && "column" in aGenerated && aOriginal && "line" in aOriginal && "column" in aOriginal && aGenerated.line > 0 && aGenerated.column >= 0 && aOriginal.line > 0 && aOriginal.column >= 0 && aSource) {
          } else {
            throw new Error("Invalid mapping: " + JSON.stringify({
              generated: aGenerated,
              source: aSource,
              original: aOriginal,
              name: aName
            }));
          }
        }
        /**
         * Serialize the accumulated mappings in to the stream of base 64 VLQs
         * specified by the source map format.
         */
        _serializeMappings() {
          let previousGeneratedColumn = 0;
          let previousGeneratedLine = 1;
          let previousOriginalColumn = 0;
          let previousOriginalLine = 0;
          let previousName = 0;
          let previousSource = 0;
          let result = "";
          let next;
          let mapping;
          let nameIdx;
          let sourceIdx;
          const mappings = this._mappings.toArray();
          for (let i = 0, len = mappings.length; i < len; i++) {
            mapping = mappings[i];
            next = "";
            if (mapping.generatedLine !== previousGeneratedLine) {
              previousGeneratedColumn = 0;
              while (mapping.generatedLine !== previousGeneratedLine) {
                next += ";";
                previousGeneratedLine++;
              }
            } else if (i > 0) {
              if (!util.compareByGeneratedPositionsInflated(mapping, mappings[i - 1])) {
                continue;
              }
              next += ",";
            }
            next += base64VLQ.encode(mapping.generatedColumn - previousGeneratedColumn);
            previousGeneratedColumn = mapping.generatedColumn;
            if (mapping.source != null) {
              sourceIdx = this._sources.indexOf(mapping.source);
              next += base64VLQ.encode(sourceIdx - previousSource);
              previousSource = sourceIdx;
              next += base64VLQ.encode(mapping.originalLine - 1 - previousOriginalLine);
              previousOriginalLine = mapping.originalLine - 1;
              next += base64VLQ.encode(mapping.originalColumn - previousOriginalColumn);
              previousOriginalColumn = mapping.originalColumn;
              if (mapping.name != null) {
                nameIdx = this._names.indexOf(mapping.name);
                next += base64VLQ.encode(nameIdx - previousName);
                previousName = nameIdx;
              }
            }
            result += next;
          }
          return result;
        }
        _generateSourcesContent(aSources, aSourceRoot) {
          return aSources.map(function(source) {
            if (!this._sourcesContents) {
              return null;
            }
            if (aSourceRoot != null) {
              source = util.relative(aSourceRoot, source);
            }
            const key = util.toSetString(source);
            return Object.prototype.hasOwnProperty.call(this._sourcesContents, key) ? this._sourcesContents[key] : null;
          }, this);
        }
        /**
         * Externalize the source map.
         */
        toJSON() {
          const map = {
            version: this._version,
            sources: this._sources.toArray(),
            names: this._names.toArray(),
            mappings: this._serializeMappings()
          };
          if (this._file != null) {
            map.file = this._file;
          }
          if (this._sourceRoot != null) {
            map.sourceRoot = this._sourceRoot;
          }
          if (this._sourcesContents) {
            map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
          }
          return map;
        }
        /**
         * Render the source map being generated to a string.
         */
        toString() {
          return JSON.stringify(this.toJSON());
        }
      };
      SourceMapGenerator.prototype._version = 3;
      exports.SourceMapGenerator = SourceMapGenerator;
    }
  });

  // ../../node_modules/source-map/lib/binary-search.js
  var require_binary_search = __commonJS({
    "../../node_modules/source-map/lib/binary-search.js"(exports) {
      init_shim_buffer();
      exports.GREATEST_LOWER_BOUND = 1;
      exports.LEAST_UPPER_BOUND = 2;
      function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare, aBias) {
        const mid = Math.floor((aHigh - aLow) / 2) + aLow;
        const cmp = aCompare(aNeedle, aHaystack[mid], true);
        if (cmp === 0) {
          return mid;
        } else if (cmp > 0) {
          if (aHigh - mid > 1) {
            return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare, aBias);
          }
          if (aBias == exports.LEAST_UPPER_BOUND) {
            return aHigh < aHaystack.length ? aHigh : -1;
          }
          return mid;
        }
        if (mid - aLow > 1) {
          return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare, aBias);
        }
        if (aBias == exports.LEAST_UPPER_BOUND) {
          return mid;
        }
        return aLow < 0 ? -1 : aLow;
      }
      exports.search = function search(aNeedle, aHaystack, aCompare, aBias) {
        if (aHaystack.length === 0) {
          return -1;
        }
        let index = recursiveSearch(
          -1,
          aHaystack.length,
          aNeedle,
          aHaystack,
          aCompare,
          aBias || exports.GREATEST_LOWER_BOUND
        );
        if (index < 0) {
          return -1;
        }
        while (index - 1 >= 0) {
          if (aCompare(aHaystack[index], aHaystack[index - 1], true) !== 0) {
            break;
          }
          --index;
        }
        return index;
      };
    }
  });

  // ../../node_modules/source-map/lib/read-wasm.js
  var require_read_wasm = __commonJS({
    "../../node_modules/source-map/lib/read-wasm.js"(exports, module) {
      init_shim_buffer();
      var isBrowserEnvironment = (function() {
        return typeof window !== "undefined" && this === window;
      }).call();
      if (isBrowserEnvironment) {
        let mappingsWasm = null;
        module.exports = function readWasm() {
          if (typeof mappingsWasm === "string") {
            return fetch(mappingsWasm).then((response) => response.arrayBuffer());
          }
          if (mappingsWasm instanceof ArrayBuffer) {
            return Promise.resolve(mappingsWasm);
          }
          throw new Error("You must provide the string URL or ArrayBuffer contents of lib/mappings.wasm by calling SourceMapConsumer.initialize({ 'lib/mappings.wasm': ... }) before using SourceMapConsumer");
        };
        module.exports.initialize = (input) => mappingsWasm = input;
      } else {
        const fs = require_stub_fs();
        const path = require_stub_path();
        module.exports = function readWasm() {
          return new Promise((resolve, reject) => {
            const wasmPath = path.join(__dirname, "mappings.wasm");
            fs.readFile(wasmPath, null, (error, data) => {
              if (error) {
                reject(error);
                return;
              }
              resolve(data.buffer);
            });
          });
        };
        module.exports.initialize = (_) => {
          console.debug("SourceMapConsumer.initialize is a no-op when running in node.js");
        };
      }
    }
  });

  // ../../node_modules/source-map/lib/wasm.js
  var require_wasm = __commonJS({
    "../../node_modules/source-map/lib/wasm.js"(exports, module) {
      init_shim_buffer();
      var readWasm = require_read_wasm();
      function Mapping() {
        this.generatedLine = 0;
        this.generatedColumn = 0;
        this.lastGeneratedColumn = null;
        this.source = null;
        this.originalLine = null;
        this.originalColumn = null;
        this.name = null;
      }
      var cachedWasm = null;
      module.exports = function wasm() {
        if (cachedWasm) {
          return cachedWasm;
        }
        const callbackStack = [];
        cachedWasm = readWasm().then((buffer) => {
          return WebAssembly.instantiate(buffer, {
            env: {
              mapping_callback(generatedLine, generatedColumn, hasLastGeneratedColumn, lastGeneratedColumn, hasOriginal, source, originalLine, originalColumn, hasName, name) {
                const mapping = new Mapping();
                mapping.generatedLine = generatedLine + 1;
                mapping.generatedColumn = generatedColumn;
                if (hasLastGeneratedColumn) {
                  mapping.lastGeneratedColumn = lastGeneratedColumn - 1;
                }
                if (hasOriginal) {
                  mapping.source = source;
                  mapping.originalLine = originalLine + 1;
                  mapping.originalColumn = originalColumn;
                  if (hasName) {
                    mapping.name = name;
                  }
                }
                callbackStack[callbackStack.length - 1](mapping);
              },
              start_all_generated_locations_for() {
                console.time("all_generated_locations_for");
              },
              end_all_generated_locations_for() {
                console.timeEnd("all_generated_locations_for");
              },
              start_compute_column_spans() {
                console.time("compute_column_spans");
              },
              end_compute_column_spans() {
                console.timeEnd("compute_column_spans");
              },
              start_generated_location_for() {
                console.time("generated_location_for");
              },
              end_generated_location_for() {
                console.timeEnd("generated_location_for");
              },
              start_original_location_for() {
                console.time("original_location_for");
              },
              end_original_location_for() {
                console.timeEnd("original_location_for");
              },
              start_parse_mappings() {
                console.time("parse_mappings");
              },
              end_parse_mappings() {
                console.timeEnd("parse_mappings");
              },
              start_sort_by_generated_location() {
                console.time("sort_by_generated_location");
              },
              end_sort_by_generated_location() {
                console.timeEnd("sort_by_generated_location");
              },
              start_sort_by_original_location() {
                console.time("sort_by_original_location");
              },
              end_sort_by_original_location() {
                console.timeEnd("sort_by_original_location");
              }
            }
          });
        }).then((Wasm) => {
          return {
            exports: Wasm.instance.exports,
            withMappingCallback: (mappingCallback, f) => {
              callbackStack.push(mappingCallback);
              try {
                f();
              } finally {
                callbackStack.pop();
              }
            }
          };
        }).then(null, (e) => {
          cachedWasm = null;
          throw e;
        });
        return cachedWasm;
      };
    }
  });

  // ../../node_modules/source-map/lib/source-map-consumer.js
  var require_source_map_consumer = __commonJS({
    "../../node_modules/source-map/lib/source-map-consumer.js"(exports) {
      init_shim_buffer();
      var util = require_util2();
      var binarySearch = require_binary_search();
      var ArraySet = require_array_set().ArraySet;
      var base64VLQ = require_base64_vlq();
      var readWasm = require_read_wasm();
      var wasm = require_wasm();
      var INTERNAL = /* @__PURE__ */ Symbol("smcInternal");
      var SourceMapConsumer = class _SourceMapConsumer {
        constructor(aSourceMap, aSourceMapURL) {
          if (aSourceMap == INTERNAL) {
            return Promise.resolve(this);
          }
          return _factory(aSourceMap, aSourceMapURL);
        }
        static initialize(opts) {
          readWasm.initialize(opts["lib/mappings.wasm"]);
        }
        static fromSourceMap(aSourceMap, aSourceMapURL) {
          return _factoryBSM(aSourceMap, aSourceMapURL);
        }
        /**
         * Construct a new `SourceMapConsumer` from `rawSourceMap` and `sourceMapUrl`
         * (see the `SourceMapConsumer` constructor for details. Then, invoke the `async
         * function f(SourceMapConsumer) -> T` with the newly constructed consumer, wait
         * for `f` to complete, call `destroy` on the consumer, and return `f`'s return
         * value.
         *
         * You must not use the consumer after `f` completes!
         *
         * By using `with`, you do not have to remember to manually call `destroy` on
         * the consumer, since it will be called automatically once `f` completes.
         *
         * ```js
         * const xSquared = await SourceMapConsumer.with(
         *   myRawSourceMap,
         *   null,
         *   async function (consumer) {
         *     // Use `consumer` inside here and don't worry about remembering
         *     // to call `destroy`.
         *
         *     const x = await whatever(consumer);
         *     return x * x;
         *   }
         * );
         *
         * // You may not use that `consumer` anymore out here; it has
         * // been destroyed. But you can use `xSquared`.
         * console.log(xSquared);
         * ```
         */
        static async with(rawSourceMap, sourceMapUrl, f) {
          const consumer = await new _SourceMapConsumer(rawSourceMap, sourceMapUrl);
          try {
            return await f(consumer);
          } finally {
            consumer.destroy();
          }
        }
        /**
         * Parse the mappings in a string in to a data structure which we can easily
         * query (the ordered arrays in the `this.__generatedMappings` and
         * `this.__originalMappings` properties).
         */
        _parseMappings(aStr, aSourceRoot) {
          throw new Error("Subclasses must implement _parseMappings");
        }
        /**
         * Iterate over each mapping between an original source/line/column and a
         * generated line/column in this source map.
         *
         * @param Function aCallback
         *        The function that is called with each mapping.
         * @param Object aContext
         *        Optional. If specified, this object will be the value of `this` every
         *        time that `aCallback` is called.
         * @param aOrder
         *        Either `SourceMapConsumer.GENERATED_ORDER` or
         *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
         *        iterate over the mappings sorted by the generated file's line/column
         *        order or the original's source/line/column order, respectively. Defaults to
         *        `SourceMapConsumer.GENERATED_ORDER`.
         */
        eachMapping(aCallback, aContext, aOrder) {
          throw new Error("Subclasses must implement eachMapping");
        }
        /**
         * Returns all generated line and column information for the original source,
         * line, and column provided. If no column is provided, returns all mappings
         * corresponding to a either the line we are searching for or the next
         * closest line that has any mappings. Otherwise, returns all mappings
         * corresponding to the given line and either the column we are searching for
         * or the next closest column that has any offsets.
         *
         * The only argument is an object with the following properties:
         *
         *   - source: The filename of the original source.
         *   - line: The line number in the original source.  The line number is 1-based.
         *   - column: Optional. the column number in the original source.
         *    The column number is 0-based.
         *
         * and an array of objects is returned, each with the following properties:
         *
         *   - line: The line number in the generated source, or null.  The
         *    line number is 1-based.
         *   - column: The column number in the generated source, or null.
         *    The column number is 0-based.
         */
        allGeneratedPositionsFor(aArgs) {
          throw new Error("Subclasses must implement allGeneratedPositionsFor");
        }
        destroy() {
          throw new Error("Subclasses must implement destroy");
        }
      };
      SourceMapConsumer.prototype._version = 3;
      SourceMapConsumer.GENERATED_ORDER = 1;
      SourceMapConsumer.ORIGINAL_ORDER = 2;
      SourceMapConsumer.GREATEST_LOWER_BOUND = 1;
      SourceMapConsumer.LEAST_UPPER_BOUND = 2;
      exports.SourceMapConsumer = SourceMapConsumer;
      var BasicSourceMapConsumer = class _BasicSourceMapConsumer extends SourceMapConsumer {
        constructor(aSourceMap, aSourceMapURL) {
          return super(INTERNAL).then((that) => {
            let sourceMap = aSourceMap;
            if (typeof aSourceMap === "string") {
              sourceMap = util.parseSourceMapInput(aSourceMap);
            }
            const version = util.getArg(sourceMap, "version");
            let sources = util.getArg(sourceMap, "sources");
            const names = util.getArg(sourceMap, "names", []);
            let sourceRoot = util.getArg(sourceMap, "sourceRoot", null);
            const sourcesContent = util.getArg(sourceMap, "sourcesContent", null);
            const mappings = util.getArg(sourceMap, "mappings");
            const file = util.getArg(sourceMap, "file", null);
            if (version != that._version) {
              throw new Error("Unsupported version: " + version);
            }
            if (sourceRoot) {
              sourceRoot = util.normalize(sourceRoot);
            }
            sources = sources.map(String).map(util.normalize).map(function(source) {
              return sourceRoot && util.isAbsolute(sourceRoot) && util.isAbsolute(source) ? util.relative(sourceRoot, source) : source;
            });
            that._names = ArraySet.fromArray(names.map(String), true);
            that._sources = ArraySet.fromArray(sources, true);
            that._absoluteSources = that._sources.toArray().map(function(s) {
              return util.computeSourceURL(sourceRoot, s, aSourceMapURL);
            });
            that.sourceRoot = sourceRoot;
            that.sourcesContent = sourcesContent;
            that._mappings = mappings;
            that._sourceMapURL = aSourceMapURL;
            that.file = file;
            that._computedColumnSpans = false;
            that._mappingsPtr = 0;
            that._wasm = null;
            return wasm().then((w) => {
              that._wasm = w;
              return that;
            });
          });
        }
        /**
         * Utility function to find the index of a source.  Returns -1 if not
         * found.
         */
        _findSourceIndex(aSource) {
          let relativeSource = aSource;
          if (this.sourceRoot != null) {
            relativeSource = util.relative(this.sourceRoot, relativeSource);
          }
          if (this._sources.has(relativeSource)) {
            return this._sources.indexOf(relativeSource);
          }
          for (let i = 0; i < this._absoluteSources.length; ++i) {
            if (this._absoluteSources[i] == aSource) {
              return i;
            }
          }
          return -1;
        }
        /**
         * Create a BasicSourceMapConsumer from a SourceMapGenerator.
         *
         * @param SourceMapGenerator aSourceMap
         *        The source map that will be consumed.
         * @param String aSourceMapURL
         *        The URL at which the source map can be found (optional)
         * @returns BasicSourceMapConsumer
         */
        static fromSourceMap(aSourceMap, aSourceMapURL) {
          return new _BasicSourceMapConsumer(aSourceMap.toString());
        }
        get sources() {
          return this._absoluteSources.slice();
        }
        _getMappingsPtr() {
          if (this._mappingsPtr === 0) {
            this._parseMappings(this._mappings, this.sourceRoot);
          }
          return this._mappingsPtr;
        }
        /**
         * Parse the mappings in a string in to a data structure which we can easily
         * query (the ordered arrays in the `this.__generatedMappings` and
         * `this.__originalMappings` properties).
         */
        _parseMappings(aStr, aSourceRoot) {
          const size = aStr.length;
          const mappingsBufPtr = this._wasm.exports.allocate_mappings(size);
          const mappingsBuf = new Uint8Array(this._wasm.exports.memory.buffer, mappingsBufPtr, size);
          for (let i = 0; i < size; i++) {
            mappingsBuf[i] = aStr.charCodeAt(i);
          }
          const mappingsPtr = this._wasm.exports.parse_mappings(mappingsBufPtr);
          if (!mappingsPtr) {
            const error = this._wasm.exports.get_last_error();
            let msg = `Error parsing mappings (code ${error}): `;
            switch (error) {
              case 1:
                msg += "the mappings contained a negative line, column, source index, or name index";
                break;
              case 2:
                msg += "the mappings contained a number larger than 2**32";
                break;
              case 3:
                msg += "reached EOF while in the middle of parsing a VLQ";
                break;
              case 4:
                msg += "invalid base 64 character while parsing a VLQ";
                break;
              default:
                msg += "unknown error code";
                break;
            }
            throw new Error(msg);
          }
          this._mappingsPtr = mappingsPtr;
        }
        eachMapping(aCallback, aContext, aOrder) {
          const context = aContext || null;
          const order = aOrder || SourceMapConsumer.GENERATED_ORDER;
          const sourceRoot = this.sourceRoot;
          this._wasm.withMappingCallback(
            (mapping) => {
              if (mapping.source !== null) {
                mapping.source = this._sources.at(mapping.source);
                mapping.source = util.computeSourceURL(sourceRoot, mapping.source, this._sourceMapURL);
                if (mapping.name !== null) {
                  mapping.name = this._names.at(mapping.name);
                }
              }
              aCallback.call(context, mapping);
            },
            () => {
              switch (order) {
                case SourceMapConsumer.GENERATED_ORDER:
                  this._wasm.exports.by_generated_location(this._getMappingsPtr());
                  break;
                case SourceMapConsumer.ORIGINAL_ORDER:
                  this._wasm.exports.by_original_location(this._getMappingsPtr());
                  break;
                default:
                  throw new Error("Unknown order of iteration.");
              }
            }
          );
        }
        allGeneratedPositionsFor(aArgs) {
          let source = util.getArg(aArgs, "source");
          const originalLine = util.getArg(aArgs, "line");
          const originalColumn = aArgs.column || 0;
          source = this._findSourceIndex(source);
          if (source < 0) {
            return [];
          }
          if (originalLine < 1) {
            throw new Error("Line numbers must be >= 1");
          }
          if (originalColumn < 0) {
            throw new Error("Column numbers must be >= 0");
          }
          const mappings = [];
          this._wasm.withMappingCallback(
            (m) => {
              let lastColumn = m.lastGeneratedColumn;
              if (this._computedColumnSpans && lastColumn === null) {
                lastColumn = Infinity;
              }
              mappings.push({
                line: m.generatedLine,
                column: m.generatedColumn,
                lastColumn
              });
            },
            () => {
              this._wasm.exports.all_generated_locations_for(
                this._getMappingsPtr(),
                source,
                originalLine - 1,
                "column" in aArgs,
                originalColumn
              );
            }
          );
          return mappings;
        }
        destroy() {
          if (this._mappingsPtr !== 0) {
            this._wasm.exports.free_mappings(this._mappingsPtr);
            this._mappingsPtr = 0;
          }
        }
        /**
         * Compute the last column for each generated mapping. The last column is
         * inclusive.
         */
        computeColumnSpans() {
          if (this._computedColumnSpans) {
            return;
          }
          this._wasm.exports.compute_column_spans(this._getMappingsPtr());
          this._computedColumnSpans = true;
        }
        /**
         * Returns the original source, line, and column information for the generated
         * source's line and column positions provided. The only argument is an object
         * with the following properties:
         *
         *   - line: The line number in the generated source.  The line number
         *     is 1-based.
         *   - column: The column number in the generated source.  The column
         *     number is 0-based.
         *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
         *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
         *     closest element that is smaller than or greater than the one we are
         *     searching for, respectively, if the exact element cannot be found.
         *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
         *
         * and an object is returned with the following properties:
         *
         *   - source: The original source file, or null.
         *   - line: The line number in the original source, or null.  The
         *     line number is 1-based.
         *   - column: The column number in the original source, or null.  The
         *     column number is 0-based.
         *   - name: The original identifier, or null.
         */
        originalPositionFor(aArgs) {
          const needle = {
            generatedLine: util.getArg(aArgs, "line"),
            generatedColumn: util.getArg(aArgs, "column")
          };
          if (needle.generatedLine < 1) {
            throw new Error("Line numbers must be >= 1");
          }
          if (needle.generatedColumn < 0) {
            throw new Error("Column numbers must be >= 0");
          }
          let bias = util.getArg(aArgs, "bias", SourceMapConsumer.GREATEST_LOWER_BOUND);
          if (bias == null) {
            bias = SourceMapConsumer.GREATEST_LOWER_BOUND;
          }
          let mapping;
          this._wasm.withMappingCallback((m) => mapping = m, () => {
            this._wasm.exports.original_location_for(
              this._getMappingsPtr(),
              needle.generatedLine - 1,
              needle.generatedColumn,
              bias
            );
          });
          if (mapping) {
            if (mapping.generatedLine === needle.generatedLine) {
              let source = util.getArg(mapping, "source", null);
              if (source !== null) {
                source = this._sources.at(source);
                source = util.computeSourceURL(this.sourceRoot, source, this._sourceMapURL);
              }
              let name = util.getArg(mapping, "name", null);
              if (name !== null) {
                name = this._names.at(name);
              }
              return {
                source,
                line: util.getArg(mapping, "originalLine", null),
                column: util.getArg(mapping, "originalColumn", null),
                name
              };
            }
          }
          return {
            source: null,
            line: null,
            column: null,
            name: null
          };
        }
        /**
         * Return true if we have the source content for every source in the source
         * map, false otherwise.
         */
        hasContentsOfAllSources() {
          if (!this.sourcesContent) {
            return false;
          }
          return this.sourcesContent.length >= this._sources.size() && !this.sourcesContent.some(function(sc) {
            return sc == null;
          });
        }
        /**
         * Returns the original source content. The only argument is the url of the
         * original source file. Returns null if no original source content is
         * available.
         */
        sourceContentFor(aSource, nullOnMissing) {
          if (!this.sourcesContent) {
            return null;
          }
          const index = this._findSourceIndex(aSource);
          if (index >= 0) {
            return this.sourcesContent[index];
          }
          let relativeSource = aSource;
          if (this.sourceRoot != null) {
            relativeSource = util.relative(this.sourceRoot, relativeSource);
          }
          let url;
          if (this.sourceRoot != null && (url = util.urlParse(this.sourceRoot))) {
            const fileUriAbsPath = relativeSource.replace(/^file:\/\//, "");
            if (url.scheme == "file" && this._sources.has(fileUriAbsPath)) {
              return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)];
            }
            if ((!url.path || url.path == "/") && this._sources.has("/" + relativeSource)) {
              return this.sourcesContent[this._sources.indexOf("/" + relativeSource)];
            }
          }
          if (nullOnMissing) {
            return null;
          }
          throw new Error('"' + relativeSource + '" is not in the SourceMap.');
        }
        /**
         * Returns the generated line and column information for the original source,
         * line, and column positions provided. The only argument is an object with
         * the following properties:
         *
         *   - source: The filename of the original source.
         *   - line: The line number in the original source.  The line number
         *     is 1-based.
         *   - column: The column number in the original source.  The column
         *     number is 0-based.
         *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
         *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
         *     closest element that is smaller than or greater than the one we are
         *     searching for, respectively, if the exact element cannot be found.
         *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
         *
         * and an object is returned with the following properties:
         *
         *   - line: The line number in the generated source, or null.  The
         *     line number is 1-based.
         *   - column: The column number in the generated source, or null.
         *     The column number is 0-based.
         */
        generatedPositionFor(aArgs) {
          let source = util.getArg(aArgs, "source");
          source = this._findSourceIndex(source);
          if (source < 0) {
            return {
              line: null,
              column: null,
              lastColumn: null
            };
          }
          const needle = {
            source,
            originalLine: util.getArg(aArgs, "line"),
            originalColumn: util.getArg(aArgs, "column")
          };
          if (needle.originalLine < 1) {
            throw new Error("Line numbers must be >= 1");
          }
          if (needle.originalColumn < 0) {
            throw new Error("Column numbers must be >= 0");
          }
          let bias = util.getArg(aArgs, "bias", SourceMapConsumer.GREATEST_LOWER_BOUND);
          if (bias == null) {
            bias = SourceMapConsumer.GREATEST_LOWER_BOUND;
          }
          let mapping;
          this._wasm.withMappingCallback((m) => mapping = m, () => {
            this._wasm.exports.generated_location_for(
              this._getMappingsPtr(),
              needle.source,
              needle.originalLine - 1,
              needle.originalColumn,
              bias
            );
          });
          if (mapping) {
            if (mapping.source === needle.source) {
              let lastColumn = mapping.lastGeneratedColumn;
              if (this._computedColumnSpans && lastColumn === null) {
                lastColumn = Infinity;
              }
              return {
                line: util.getArg(mapping, "generatedLine", null),
                column: util.getArg(mapping, "generatedColumn", null),
                lastColumn
              };
            }
          }
          return {
            line: null,
            column: null,
            lastColumn: null
          };
        }
      };
      BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer;
      exports.BasicSourceMapConsumer = BasicSourceMapConsumer;
      var IndexedSourceMapConsumer = class extends SourceMapConsumer {
        constructor(aSourceMap, aSourceMapURL) {
          return super(INTERNAL).then((that) => {
            let sourceMap = aSourceMap;
            if (typeof aSourceMap === "string") {
              sourceMap = util.parseSourceMapInput(aSourceMap);
            }
            const version = util.getArg(sourceMap, "version");
            const sections = util.getArg(sourceMap, "sections");
            if (version != that._version) {
              throw new Error("Unsupported version: " + version);
            }
            that._sources = new ArraySet();
            that._names = new ArraySet();
            that.__generatedMappings = null;
            that.__originalMappings = null;
            that.__generatedMappingsUnsorted = null;
            that.__originalMappingsUnsorted = null;
            let lastOffset = {
              line: -1,
              column: 0
            };
            return Promise.all(sections.map((s) => {
              if (s.url) {
                throw new Error("Support for url field in sections not implemented.");
              }
              const offset = util.getArg(s, "offset");
              const offsetLine = util.getArg(offset, "line");
              const offsetColumn = util.getArg(offset, "column");
              if (offsetLine < lastOffset.line || offsetLine === lastOffset.line && offsetColumn < lastOffset.column) {
                throw new Error("Section offsets must be ordered and non-overlapping.");
              }
              lastOffset = offset;
              const cons = new SourceMapConsumer(util.getArg(s, "map"), aSourceMapURL);
              return cons.then((consumer) => {
                return {
                  generatedOffset: {
                    // The offset fields are 0-based, but we use 1-based indices when
                    // encoding/decoding from VLQ.
                    generatedLine: offsetLine + 1,
                    generatedColumn: offsetColumn + 1
                  },
                  consumer
                };
              });
            })).then((s) => {
              that._sections = s;
              return that;
            });
          });
        }
        // `__generatedMappings` and `__originalMappings` are arrays that hold the
        // parsed mapping coordinates from the source map's "mappings" attribute. They
        // are lazily instantiated, accessed via the `_generatedMappings` and
        // `_originalMappings` getters respectively, and we only parse the mappings
        // and create these arrays once queried for a source location. We jump through
        // these hoops because there can be many thousands of mappings, and parsing
        // them is expensive, so we only want to do it if we must.
        //
        // Each object in the arrays is of the form:
        //
        //     {
        //       generatedLine: The line number in the generated code,
        //       generatedColumn: The column number in the generated code,
        //       source: The path to the original source file that generated this
        //               chunk of code,
        //       originalLine: The line number in the original source that
        //                     corresponds to this chunk of generated code,
        //       originalColumn: The column number in the original source that
        //                       corresponds to this chunk of generated code,
        //       name: The name of the original symbol which generated this chunk of
        //             code.
        //     }
        //
        // All properties except for `generatedLine` and `generatedColumn` can be
        // `null`.
        //
        // `_generatedMappings` is ordered by the generated positions.
        //
        // `_originalMappings` is ordered by the original positions.
        get _generatedMappings() {
          if (!this.__generatedMappings) {
            this._sortGeneratedMappings();
          }
          return this.__generatedMappings;
        }
        get _originalMappings() {
          if (!this.__originalMappings) {
            this._sortOriginalMappings();
          }
          return this.__originalMappings;
        }
        get _generatedMappingsUnsorted() {
          if (!this.__generatedMappingsUnsorted) {
            this._parseMappings(this._mappings, this.sourceRoot);
          }
          return this.__generatedMappingsUnsorted;
        }
        get _originalMappingsUnsorted() {
          if (!this.__originalMappingsUnsorted) {
            this._parseMappings(this._mappings, this.sourceRoot);
          }
          return this.__originalMappingsUnsorted;
        }
        _sortGeneratedMappings() {
          const mappings = this._generatedMappingsUnsorted;
          mappings.sort(util.compareByGeneratedPositionsDeflated);
          this.__generatedMappings = mappings;
        }
        _sortOriginalMappings() {
          const mappings = this._originalMappingsUnsorted;
          mappings.sort(util.compareByOriginalPositions);
          this.__originalMappings = mappings;
        }
        /**
         * The list of original sources.
         */
        get sources() {
          const sources = [];
          for (let i = 0; i < this._sections.length; i++) {
            for (let j = 0; j < this._sections[i].consumer.sources.length; j++) {
              sources.push(this._sections[i].consumer.sources[j]);
            }
          }
          return sources;
        }
        /**
         * Returns the original source, line, and column information for the generated
         * source's line and column positions provided. The only argument is an object
         * with the following properties:
         *
         *   - line: The line number in the generated source.  The line number
         *     is 1-based.
         *   - column: The column number in the generated source.  The column
         *     number is 0-based.
         *
         * and an object is returned with the following properties:
         *
         *   - source: The original source file, or null.
         *   - line: The line number in the original source, or null.  The
         *     line number is 1-based.
         *   - column: The column number in the original source, or null.  The
         *     column number is 0-based.
         *   - name: The original identifier, or null.
         */
        originalPositionFor(aArgs) {
          const needle = {
            generatedLine: util.getArg(aArgs, "line"),
            generatedColumn: util.getArg(aArgs, "column")
          };
          const sectionIndex = binarySearch.search(
            needle,
            this._sections,
            function(aNeedle, section2) {
              const cmp = aNeedle.generatedLine - section2.generatedOffset.generatedLine;
              if (cmp) {
                return cmp;
              }
              return aNeedle.generatedColumn - section2.generatedOffset.generatedColumn;
            }
          );
          const section = this._sections[sectionIndex];
          if (!section) {
            return {
              source: null,
              line: null,
              column: null,
              name: null
            };
          }
          return section.consumer.originalPositionFor({
            line: needle.generatedLine - (section.generatedOffset.generatedLine - 1),
            column: needle.generatedColumn - (section.generatedOffset.generatedLine === needle.generatedLine ? section.generatedOffset.generatedColumn - 1 : 0),
            bias: aArgs.bias
          });
        }
        /**
         * Return true if we have the source content for every source in the source
         * map, false otherwise.
         */
        hasContentsOfAllSources() {
          return this._sections.every(function(s) {
            return s.consumer.hasContentsOfAllSources();
          });
        }
        /**
         * Returns the original source content. The only argument is the url of the
         * original source file. Returns null if no original source content is
         * available.
         */
        sourceContentFor(aSource, nullOnMissing) {
          for (let i = 0; i < this._sections.length; i++) {
            const section = this._sections[i];
            const content = section.consumer.sourceContentFor(aSource, true);
            if (content) {
              return content;
            }
          }
          if (nullOnMissing) {
            return null;
          }
          throw new Error('"' + aSource + '" is not in the SourceMap.');
        }
        /**
         * Returns the generated line and column information for the original source,
         * line, and column positions provided. The only argument is an object with
         * the following properties:
         *
         *   - source: The filename of the original source.
         *   - line: The line number in the original source.  The line number
         *     is 1-based.
         *   - column: The column number in the original source.  The column
         *     number is 0-based.
         *
         * and an object is returned with the following properties:
         *
         *   - line: The line number in the generated source, or null.  The
         *     line number is 1-based.
         *   - column: The column number in the generated source, or null.
         *     The column number is 0-based.
         */
        generatedPositionFor(aArgs) {
          for (let i = 0; i < this._sections.length; i++) {
            const section = this._sections[i];
            if (section.consumer._findSourceIndex(util.getArg(aArgs, "source")) === -1) {
              continue;
            }
            const generatedPosition = section.consumer.generatedPositionFor(aArgs);
            if (generatedPosition) {
              const ret = {
                line: generatedPosition.line + (section.generatedOffset.generatedLine - 1),
                column: generatedPosition.column + (section.generatedOffset.generatedLine === generatedPosition.line ? section.generatedOffset.generatedColumn - 1 : 0)
              };
              return ret;
            }
          }
          return {
            line: null,
            column: null
          };
        }
        /**
         * Parse the mappings in a string in to a data structure which we can easily
         * query (the ordered arrays in the `this.__generatedMappings` and
         * `this.__originalMappings` properties).
         */
        _parseMappings(aStr, aSourceRoot) {
          const generatedMappings = this.__generatedMappingsUnsorted = [];
          const originalMappings = this.__originalMappingsUnsorted = [];
          for (let i = 0; i < this._sections.length; i++) {
            const section = this._sections[i];
            const sectionMappings = [];
            section.consumer.eachMapping((m) => sectionMappings.push(m));
            for (let j = 0; j < sectionMappings.length; j++) {
              const mapping = sectionMappings[j];
              let source = util.computeSourceURL(section.consumer.sourceRoot, null, this._sourceMapURL);
              this._sources.add(source);
              source = this._sources.indexOf(source);
              let name = null;
              if (mapping.name) {
                this._names.add(mapping.name);
                name = this._names.indexOf(mapping.name);
              }
              const adjustedMapping = {
                source,
                generatedLine: mapping.generatedLine + (section.generatedOffset.generatedLine - 1),
                generatedColumn: mapping.generatedColumn + (section.generatedOffset.generatedLine === mapping.generatedLine ? section.generatedOffset.generatedColumn - 1 : 0),
                originalLine: mapping.originalLine,
                originalColumn: mapping.originalColumn,
                name
              };
              generatedMappings.push(adjustedMapping);
              if (typeof adjustedMapping.originalLine === "number") {
                originalMappings.push(adjustedMapping);
              }
            }
          }
        }
        eachMapping(aCallback, aContext, aOrder) {
          const context = aContext || null;
          const order = aOrder || SourceMapConsumer.GENERATED_ORDER;
          let mappings;
          switch (order) {
            case SourceMapConsumer.GENERATED_ORDER:
              mappings = this._generatedMappings;
              break;
            case SourceMapConsumer.ORIGINAL_ORDER:
              mappings = this._originalMappings;
              break;
            default:
              throw new Error("Unknown order of iteration.");
          }
          const sourceRoot = this.sourceRoot;
          mappings.map(function(mapping) {
            let source = null;
            if (mapping.source !== null) {
              source = this._sources.at(mapping.source);
              source = util.computeSourceURL(sourceRoot, source, this._sourceMapURL);
            }
            return {
              source,
              generatedLine: mapping.generatedLine,
              generatedColumn: mapping.generatedColumn,
              originalLine: mapping.originalLine,
              originalColumn: mapping.originalColumn,
              name: mapping.name === null ? null : this._names.at(mapping.name)
            };
          }, this).forEach(aCallback, context);
        }
        /**
         * Find the mapping that best matches the hypothetical "needle" mapping that
         * we are searching for in the given "haystack" of mappings.
         */
        _findMapping(aNeedle, aMappings, aLineName, aColumnName, aComparator, aBias) {
          if (aNeedle[aLineName] <= 0) {
            throw new TypeError("Line must be greater than or equal to 1, got " + aNeedle[aLineName]);
          }
          if (aNeedle[aColumnName] < 0) {
            throw new TypeError("Column must be greater than or equal to 0, got " + aNeedle[aColumnName]);
          }
          return binarySearch.search(aNeedle, aMappings, aComparator, aBias);
        }
        allGeneratedPositionsFor(aArgs) {
          const line = util.getArg(aArgs, "line");
          const needle = {
            source: util.getArg(aArgs, "source"),
            originalLine: line,
            originalColumn: util.getArg(aArgs, "column", 0)
          };
          needle.source = this._findSourceIndex(needle.source);
          if (needle.source < 0) {
            return [];
          }
          if (needle.originalLine < 1) {
            throw new Error("Line numbers must be >= 1");
          }
          if (needle.originalColumn < 0) {
            throw new Error("Column numbers must be >= 0");
          }
          const mappings = [];
          let index = this._findMapping(
            needle,
            this._originalMappings,
            "originalLine",
            "originalColumn",
            util.compareByOriginalPositions,
            binarySearch.LEAST_UPPER_BOUND
          );
          if (index >= 0) {
            let mapping = this._originalMappings[index];
            if (aArgs.column === void 0) {
              const originalLine = mapping.originalLine;
              while (mapping && mapping.originalLine === originalLine) {
                let lastColumn = mapping.lastGeneratedColumn;
                if (this._computedColumnSpans && lastColumn === null) {
                  lastColumn = Infinity;
                }
                mappings.push({
                  line: util.getArg(mapping, "generatedLine", null),
                  column: util.getArg(mapping, "generatedColumn", null),
                  lastColumn
                });
                mapping = this._originalMappings[++index];
              }
            } else {
              const originalColumn = mapping.originalColumn;
              while (mapping && mapping.originalLine === line && mapping.originalColumn == originalColumn) {
                let lastColumn = mapping.lastGeneratedColumn;
                if (this._computedColumnSpans && lastColumn === null) {
                  lastColumn = Infinity;
                }
                mappings.push({
                  line: util.getArg(mapping, "generatedLine", null),
                  column: util.getArg(mapping, "generatedColumn", null),
                  lastColumn
                });
                mapping = this._originalMappings[++index];
              }
            }
          }
          return mappings;
        }
        destroy() {
          for (let i = 0; i < this._sections.length; i++) {
            this._sections[i].consumer.destroy();
          }
        }
      };
      exports.IndexedSourceMapConsumer = IndexedSourceMapConsumer;
      function _factory(aSourceMap, aSourceMapURL) {
        let sourceMap = aSourceMap;
        if (typeof aSourceMap === "string") {
          sourceMap = util.parseSourceMapInput(aSourceMap);
        }
        const consumer = sourceMap.sections != null ? new IndexedSourceMapConsumer(sourceMap, aSourceMapURL) : new BasicSourceMapConsumer(sourceMap, aSourceMapURL);
        return Promise.resolve(consumer);
      }
      function _factoryBSM(aSourceMap, aSourceMapURL) {
        return BasicSourceMapConsumer.fromSourceMap(aSourceMap, aSourceMapURL);
      }
    }
  });

  // ../../node_modules/source-map/lib/source-node.js
  var require_source_node = __commonJS({
    "../../node_modules/source-map/lib/source-node.js"(exports) {
      init_shim_buffer();
      var SourceMapGenerator = require_source_map_generator().SourceMapGenerator;
      var util = require_util2();
      var REGEX_NEWLINE = /(\r?\n)/;
      var NEWLINE_CODE = 10;
      var isSourceNode = "$$$isSourceNode$$$";
      var SourceNode = class _SourceNode {
        constructor(aLine, aColumn, aSource, aChunks, aName) {
          this.children = [];
          this.sourceContents = {};
          this.line = aLine == null ? null : aLine;
          this.column = aColumn == null ? null : aColumn;
          this.source = aSource == null ? null : aSource;
          this.name = aName == null ? null : aName;
          this[isSourceNode] = true;
          if (aChunks != null) this.add(aChunks);
        }
        /**
         * Creates a SourceNode from generated code and a SourceMapConsumer.
         *
         * @param aGeneratedCode The generated code
         * @param aSourceMapConsumer The SourceMap for the generated code
         * @param aRelativePath Optional. The path that relative sources in the
         *        SourceMapConsumer should be relative to.
         */
        static fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer, aRelativePath) {
          const node = new _SourceNode();
          const remainingLines = aGeneratedCode.split(REGEX_NEWLINE);
          let remainingLinesIndex = 0;
          const shiftNextLine = function() {
            const lineContents = getNextLine();
            const newLine = getNextLine() || "";
            return lineContents + newLine;
            function getNextLine() {
              return remainingLinesIndex < remainingLines.length ? remainingLines[remainingLinesIndex++] : void 0;
            }
          };
          let lastGeneratedLine = 1, lastGeneratedColumn = 0;
          let lastMapping = null;
          let nextLine;
          aSourceMapConsumer.eachMapping(function(mapping) {
            if (lastMapping !== null) {
              if (lastGeneratedLine < mapping.generatedLine) {
                addMappingWithCode(lastMapping, shiftNextLine());
                lastGeneratedLine++;
                lastGeneratedColumn = 0;
              } else {
                nextLine = remainingLines[remainingLinesIndex] || "";
                const code = nextLine.substr(0, mapping.generatedColumn - lastGeneratedColumn);
                remainingLines[remainingLinesIndex] = nextLine.substr(mapping.generatedColumn - lastGeneratedColumn);
                lastGeneratedColumn = mapping.generatedColumn;
                addMappingWithCode(lastMapping, code);
                lastMapping = mapping;
                return;
              }
            }
            while (lastGeneratedLine < mapping.generatedLine) {
              node.add(shiftNextLine());
              lastGeneratedLine++;
            }
            if (lastGeneratedColumn < mapping.generatedColumn) {
              nextLine = remainingLines[remainingLinesIndex] || "";
              node.add(nextLine.substr(0, mapping.generatedColumn));
              remainingLines[remainingLinesIndex] = nextLine.substr(mapping.generatedColumn);
              lastGeneratedColumn = mapping.generatedColumn;
            }
            lastMapping = mapping;
          }, this);
          if (remainingLinesIndex < remainingLines.length) {
            if (lastMapping) {
              addMappingWithCode(lastMapping, shiftNextLine());
            }
            node.add(remainingLines.splice(remainingLinesIndex).join(""));
          }
          aSourceMapConsumer.sources.forEach(function(sourceFile) {
            const content = aSourceMapConsumer.sourceContentFor(sourceFile);
            if (content != null) {
              if (aRelativePath != null) {
                sourceFile = util.join(aRelativePath, sourceFile);
              }
              node.setSourceContent(sourceFile, content);
            }
          });
          return node;
          function addMappingWithCode(mapping, code) {
            if (mapping === null || mapping.source === void 0) {
              node.add(code);
            } else {
              const source = aRelativePath ? util.join(aRelativePath, mapping.source) : mapping.source;
              node.add(new _SourceNode(
                mapping.originalLine,
                mapping.originalColumn,
                source,
                code,
                mapping.name
              ));
            }
          }
        }
        /**
         * Add a chunk of generated JS to this source node.
         *
         * @param aChunk A string snippet of generated JS code, another instance of
         *        SourceNode, or an array where each member is one of those things.
         */
        add(aChunk) {
          if (Array.isArray(aChunk)) {
            aChunk.forEach(function(chunk) {
              this.add(chunk);
            }, this);
          } else if (aChunk[isSourceNode] || typeof aChunk === "string") {
            if (aChunk) {
              this.children.push(aChunk);
            }
          } else {
            throw new TypeError(
              "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
            );
          }
          return this;
        }
        /**
         * Add a chunk of generated JS to the beginning of this source node.
         *
         * @param aChunk A string snippet of generated JS code, another instance of
         *        SourceNode, or an array where each member is one of those things.
         */
        prepend(aChunk) {
          if (Array.isArray(aChunk)) {
            for (let i = aChunk.length - 1; i >= 0; i--) {
              this.prepend(aChunk[i]);
            }
          } else if (aChunk[isSourceNode] || typeof aChunk === "string") {
            this.children.unshift(aChunk);
          } else {
            throw new TypeError(
              "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
            );
          }
          return this;
        }
        /**
         * Walk over the tree of JS snippets in this node and its children. The
         * walking function is called once for each snippet of JS and is passed that
         * snippet and the its original associated source's line/column location.
         *
         * @param aFn The traversal function.
         */
        walk(aFn) {
          let chunk;
          for (let i = 0, len = this.children.length; i < len; i++) {
            chunk = this.children[i];
            if (chunk[isSourceNode]) {
              chunk.walk(aFn);
            } else if (chunk !== "") {
              aFn(chunk, {
                source: this.source,
                line: this.line,
                column: this.column,
                name: this.name
              });
            }
          }
        }
        /**
         * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
         * each of `this.children`.
         *
         * @param aSep The separator.
         */
        join(aSep) {
          let newChildren;
          let i;
          const len = this.children.length;
          if (len > 0) {
            newChildren = [];
            for (i = 0; i < len - 1; i++) {
              newChildren.push(this.children[i]);
              newChildren.push(aSep);
            }
            newChildren.push(this.children[i]);
            this.children = newChildren;
          }
          return this;
        }
        /**
         * Call String.prototype.replace on the very right-most source snippet. Useful
         * for trimming whitespace from the end of a source node, etc.
         *
         * @param aPattern The pattern to replace.
         * @param aReplacement The thing to replace the pattern with.
         */
        replaceRight(aPattern, aReplacement) {
          const lastChild = this.children[this.children.length - 1];
          if (lastChild[isSourceNode]) {
            lastChild.replaceRight(aPattern, aReplacement);
          } else if (typeof lastChild === "string") {
            this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
          } else {
            this.children.push("".replace(aPattern, aReplacement));
          }
          return this;
        }
        /**
         * Set the source content for a source file. This will be added to the SourceMapGenerator
         * in the sourcesContent field.
         *
         * @param aSourceFile The filename of the source file
         * @param aSourceContent The content of the source file
         */
        setSourceContent(aSourceFile, aSourceContent) {
          this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
        }
        /**
         * Walk over the tree of SourceNodes. The walking function is called for each
         * source file content and is passed the filename and source content.
         *
         * @param aFn The traversal function.
         */
        walkSourceContents(aFn) {
          for (let i = 0, len = this.children.length; i < len; i++) {
            if (this.children[i][isSourceNode]) {
              this.children[i].walkSourceContents(aFn);
            }
          }
          const sources = Object.keys(this.sourceContents);
          for (let i = 0, len = sources.length; i < len; i++) {
            aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
          }
        }
        /**
         * Return the string representation of this source node. Walks over the tree
         * and concatenates all the various snippets together to one string.
         */
        toString() {
          let str = "";
          this.walk(function(chunk) {
            str += chunk;
          });
          return str;
        }
        /**
         * Returns the string representation of this source node along with a source
         * map.
         */
        toStringWithSourceMap(aArgs) {
          const generated = {
            code: "",
            line: 1,
            column: 0
          };
          const map = new SourceMapGenerator(aArgs);
          let sourceMappingActive = false;
          let lastOriginalSource = null;
          let lastOriginalLine = null;
          let lastOriginalColumn = null;
          let lastOriginalName = null;
          this.walk(function(chunk, original) {
            generated.code += chunk;
            if (original.source !== null && original.line !== null && original.column !== null) {
              if (lastOriginalSource !== original.source || lastOriginalLine !== original.line || lastOriginalColumn !== original.column || lastOriginalName !== original.name) {
                map.addMapping({
                  source: original.source,
                  original: {
                    line: original.line,
                    column: original.column
                  },
                  generated: {
                    line: generated.line,
                    column: generated.column
                  },
                  name: original.name
                });
              }
              lastOriginalSource = original.source;
              lastOriginalLine = original.line;
              lastOriginalColumn = original.column;
              lastOriginalName = original.name;
              sourceMappingActive = true;
            } else if (sourceMappingActive) {
              map.addMapping({
                generated: {
                  line: generated.line,
                  column: generated.column
                }
              });
              lastOriginalSource = null;
              sourceMappingActive = false;
            }
            for (let idx = 0, length = chunk.length; idx < length; idx++) {
              if (chunk.charCodeAt(idx) === NEWLINE_CODE) {
                generated.line++;
                generated.column = 0;
                if (idx + 1 === length) {
                  lastOriginalSource = null;
                  sourceMappingActive = false;
                } else if (sourceMappingActive) {
                  map.addMapping({
                    source: original.source,
                    original: {
                      line: original.line,
                      column: original.column
                    },
                    generated: {
                      line: generated.line,
                      column: generated.column
                    },
                    name: original.name
                  });
                }
              } else {
                generated.column++;
              }
            }
          });
          this.walkSourceContents(function(sourceFile, sourceContent) {
            map.setSourceContent(sourceFile, sourceContent);
          });
          return { code: generated.code, map };
        }
      };
      exports.SourceNode = SourceNode;
    }
  });

  // ../../node_modules/source-map/source-map.js
  var require_source_map = __commonJS({
    "../../node_modules/source-map/source-map.js"(exports) {
      init_shim_buffer();
      exports.SourceMapGenerator = require_source_map_generator().SourceMapGenerator;
      exports.SourceMapConsumer = require_source_map_consumer().SourceMapConsumer;
      exports.SourceNode = require_source_node().SourceNode;
    }
  });

  // lib/ast.js
  var require_ast = __commonJS({
    "lib/ast.js"(exports) {
      init_shim_buffer();
      var fold;
      var ref$;
      var nameFromPath;
      var stripString;
      var SourceNode;
      var SourceMapGenerator;
      var sn;
      var snEmpty;
      var snSafe;
      var snRemoveLeft;
      var Node;
      var Negatable;
      var Block;
      var Atom;
      var Literal;
      var Var;
      var Key;
      var Index;
      var Slice;
      var Chain;
      var Call;
      var List;
      var Obj;
      var Prop;
      var Arr;
      var Yield;
      var Unary;
      var Binary;
      var Assign;
      var Import;
      var In;
      var Existence;
      var Fun;
      var Class;
      var Super;
      var Parens;
      var Splat;
      var Jump;
      var Throw;
      var Return;
      var While;
      var For;
      var StepSlice;
      var Try;
      var Switch;
      var Case;
      var If;
      var Label;
      var Cascade;
      var JS;
      var Require;
      var Util;
      var Vars;
      var CopyL;
      var DECLS;
      var UTILS;
      var LEVEL_TOP;
      var LEVEL_PAREN;
      var LEVEL_LIST;
      var LEVEL_COND;
      var LEVEL_OP;
      var LEVEL_CALL;
      var PREC;
      var TAB;
      var ID;
      var SIMPLENUM;
      var slice$ = [].slice;
      var arrayFrom$ = Array.from || function(x) {
        return slice$.call(x);
      };
      var toString$ = {}.toString;
      fold = require_lib().fold;
      ref$ = require_util(), nameFromPath = ref$.nameFromPath, stripString = ref$.stripString;
      ref$ = require_source_map(), SourceNode = ref$.SourceNode, SourceMapGenerator = ref$.SourceMapGenerator;
      sn = function(node) {
        var parts, res$, i$, to$, result, e;
        node == null && (node = {});
        res$ = [];
        for (i$ = 1, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        parts = res$;
        try {
          result = new SourceNode(node.line, node.column, null, parts);
          result.displayName = node.constructor.displayName;
          return result;
        } catch (e$) {
          e = e$;
          console.dir(parts);
          throw e;
        }
      };
      snEmpty = function(node) {
        var i$, ref$2, len$, child;
        if (node instanceof SourceNode) {
          for (i$ = 0, len$ = (ref$2 = node.children).length; i$ < len$; ++i$) {
            child = ref$2[i$];
            if (!snEmpty(child)) {
              return false;
            }
          }
          return true;
        } else {
          return !node;
        }
      };
      snSafe = function(code) {
        if (code instanceof SourceNode) {
          return code;
        } else {
          return code.toString();
        }
      };
      snRemoveLeft = function(node, count) {
        var i$, to$, i, child;
        for (i$ = 0, to$ = node.children.length; i$ < to$; ++i$) {
          i = i$;
          child = node.children[i];
          if (child instanceof SourceNode) {
            count = snRemoveLeft(child, count);
          } else {
            child = child.toString();
            node.children[i] = child.slice(count);
            count -= child.length;
          }
          if (count <= 0) {
            return 0;
          }
        }
        return count;
      };
      SourceNode.prototype.replace = function() {
        var args, res$, i$, to$;
        res$ = [];
        for (i$ = 0, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        args = res$;
        return new SourceNode(this.line, this.column, this.source, function() {
          var i$2, x$, ref$2, len$, results$ = [];
          for (i$2 = 0, len$ = (ref$2 = this.children).length; i$2 < len$; ++i$2) {
            x$ = ref$2[i$2];
            results$.push(x$.replace.apply(x$, args));
          }
          return results$;
        }.call(this), this.name);
      };
      SourceNode.prototype.setFile = function(filename) {
        var i$, ref$2, len$, child, results$ = [];
        this.source = filename;
        for (i$ = 0, len$ = (ref$2 = this.children).length; i$ < len$; ++i$) {
          child = ref$2[i$];
          if (child instanceof SourceNode) {
            results$.push(child.setFile(filename));
          }
        }
        return results$;
      };
      SourceNode.prototype.toStringWithSourceMap = function() {
        var args, res$, i$, to$, gen, genLine, genColumn, stack, code, debugOutput, debugIndent, debugIndentStr, genForNode;
        res$ = [];
        for (i$ = 0, to$ = arguments.length; i$ < to$; ++i$) {
          res$.push(arguments[i$]);
        }
        args = res$;
        gen = (function(func, args2, ctor) {
          ctor.prototype = func.prototype;
          var child = new ctor(), result = func.apply(child, args2), t;
          return (t = typeof result) == "object" || t == "function" ? result || child : child;
        })(SourceMapGenerator, args, function() {
        });
        genLine = 1;
        genColumn = 0;
        stack = [];
        code = "";
        debugOutput = "";
        debugIndent = "";
        debugIndentStr = "  ";
        genForNode = function(node) {
          var valid, i$2, ref$2, len$, child, cur, to$2, i, c, results$ = [];
          if (node instanceof SourceNode) {
            debugOutput += debugIndent + node.displayName;
            valid = node.line && "column" in node;
            if (valid) {
              stack.push(node);
              debugOutput += "!";
            }
            debugOutput += " " + node.line + ":" + node.column + " " + genLine + ":" + genColumn + "\n";
            debugIndent += debugIndentStr;
            for (i$2 = 0, len$ = (ref$2 = node.children).length; i$2 < len$; ++i$2) {
              child = ref$2[i$2];
              genForNode(child);
            }
            debugIndent = debugIndent.slice(0, debugIndent.length - debugIndentStr.length);
            if (valid) {
              return stack.pop();
            }
          } else {
            debugOutput += debugIndent + "" + JSON.stringify(node) + "\n";
            code += node;
            cur = stack[stack.length - 1];
            if (cur) {
              gen.addMapping({
                source: cur.source,
                original: {
                  line: cur.line,
                  column: cur.column
                },
                generated: {
                  line: genLine,
                  column: genColumn
                },
                name: cur.name
              });
            }
            for (i$2 = 0, to$2 = node.length; i$2 < to$2; ++i$2) {
              i = i$2;
              c = node.charAt(i);
              if (c === "\n") {
                genColumn = 0;
                ++genLine;
                if (cur) {
                  results$.push(gen.addMapping({
                    source: cur.source,
                    original: {
                      line: cur.line,
                      column: cur.column
                    },
                    generated: {
                      line: genLine,
                      column: genColumn
                    },
                    name: cur.name
                  }));
                }
              } else {
                results$.push(++genColumn);
              }
            }
            return results$;
          }
        };
        genForNode(this);
        return {
          code,
          map: gen,
          debug: debugOutput
        };
      };
      (Node = function() {
        throw Error("unimplemented");
      }).prototype = {
        compile: function(options, level) {
          var o, node, code, that, i$, len$, tmp;
          o = import$({}, options);
          if (level != null) {
            o.level = level;
          }
          node = this.unfoldSoak(o) || this;
          if (o.level && node.isStatement()) {
            return node.compileClosure(o);
          }
          code = (node.tab = o.indent, node).compileNode(o);
          if (that = node.temps) {
            for (i$ = 0, len$ = that.length; i$ < len$; ++i$) {
              tmp = that[i$];
              o.scope.free(tmp);
            }
          }
          return code;
        },
        compileClosure: function(o) {
          var that, fun, call, hasArgs, hasThis, out;
          if (that = this.getJump()) {
            that.carp("inconvertible statement");
          }
          fun = Fun([], Block(this));
          call = Call();
          if (o.inAsync) {
            fun.async = true;
          }
          if (o.inGenerator) {
            fun.generator = true;
          }
          this.traverseChildren(function(it) {
            switch (it.value) {
              case "this":
                hasThis = true;
                break;
              case "arguments":
                hasArgs = it.value = "args$";
            }
          });
          if (hasThis) {
            call.args.push(Literal("this"));
            call.method = ".call";
          }
          if (hasArgs) {
            call.args.push(Literal("arguments"));
            fun.params.push(Var("args$"));
          }
          out = Parens(Chain((fun.wrapper = true, fun["void"] = this["void"], fun), [call]), true);
          if (o.inGenerator) {
            out = new Yield("yieldfrom", out);
          } else if (o.inAsync) {
            out = new Yield("await", out);
          }
          return out.compile(o);
        },
        compileBlock: function(o, node) {
          var code;
          if (!snEmpty(code = node != null ? node.compile(o, LEVEL_TOP) : void 0)) {
            return sn(null, "{\n", code, "\n" + this.tab + "}");
          } else {
            return sn(node, "{}");
          }
        },
        compileSpreadOver: function(o, list, transform) {
          var ob, them, i$, len$, i, node, sp, lat, ref$2;
          ob = list instanceof Obj;
          them = list.items;
          for (i$ = 0, len$ = them.length; i$ < len$; ++i$) {
            i = i$;
            node = them[i$];
            if (sp = node instanceof Splat) {
              node = node.it;
            }
            if (ob && !sp) {
              node = node.val;
            }
            node = transform(node);
            if (sp) {
              node = lat = Splat(node);
            }
            if (ob && !sp) {
              them[i].val = node;
            } else {
              them[i] = node;
            }
          }
          if (!lat && (this["void"] || !o.level)) {
            list = (ref$2 = Block(ob ? (function() {
              var i$2, x$, ref$3, len$2, results$ = [];
              for (i$2 = 0, len$2 = (ref$3 = them).length; i$2 < len$2; ++i$2) {
                x$ = ref$3[i$2];
                results$.push(x$.val);
              }
              return results$;
            })() : them), ref$2.front = this.front, ref$2["void"] = true, ref$2);
          }
          return list.compile(o, LEVEL_PAREN);
        },
        cache: function(o, once, level, tempName) {
          var ref$2, ref, sub, tempvars;
          if (!this.isComplex()) {
            return [ref$2 = level != null ? this.compile(o, level) : this, ref$2];
          }
          if (ref = this.getRef()) {
            sub = this;
          } else {
            sub = Assign(ref = Var(o.scope.temporary(tempName)), this);
            if (once) {
              ref.temp = true;
            } else {
              tempvars = [ref.value];
            }
          }
          if (level != null) {
            sub = sub.compile(o, level);
            if (once && tempvars) {
              o.scope.free(ref.value);
            }
            return [sub, ref.value];
          }
          return [sub, ref, tempvars];
        },
        compileLoopReference: function(o, name, ret, safeAccess) {
          var ref$2, code, asn, tmp;
          if (this instanceof Var && o.scope.check(this.value) || this instanceof Unary && ((ref$2 = this.op) === "+" || ref$2 === "-") && (-1 / 0 < (ref$2 = +this.it.value) && ref$2 < 1 / 0) || this instanceof Literal && !this.isComplex()) {
            code = this.compile(o, LEVEL_PAREN);
            if (safeAccess && !(this instanceof Var)) {
              code = "(" + code + ")";
            }
            return [code, code];
          }
          asn = Assign(Var(tmp = o.scope.temporary(name)), this);
          ret || (asn["void"] = true);
          return [tmp, asn.compile(o, ret ? LEVEL_CALL : LEVEL_PAREN)];
        },
        eachChild: function(fn) {
          var i$, ref$2, len$, name, child, j$, len1$, i, node, that;
          for (i$ = 0, len$ = (ref$2 = this.children).length; i$ < len$; ++i$) {
            name = ref$2[i$];
            if (child = this[name]) {
              if ("length" in child) {
                for (j$ = 0, len1$ = child.length; j$ < len1$; ++j$) {
                  i = j$;
                  node = child[j$];
                  if (that = fn(node, name, i)) {
                    return that;
                  }
                }
              } else {
                if ((that = fn(child, name)) != null) {
                  return that;
                }
              }
            }
          }
        },
        traverseChildren: function(fn, xscope) {
          var this$ = this;
          return this.eachChild(function(node, name, index) {
            var ref$2;
            return (ref$2 = fn(node, this$, name, index)) != null ? ref$2 : node.traverseChildren(fn, xscope);
          });
        },
        rewriteShorthand: function(o, assign) {
          var i$, ref$2, len$, name, child, j$, len1$, i, node, that;
          for (i$ = 0, len$ = (ref$2 = this.children).length; i$ < len$; ++i$) {
            name = ref$2[i$];
            if (child = this[name]) {
              if ("length" in child) {
                for (j$ = 0, len1$ = child.length; j$ < len1$; ++j$) {
                  i = j$;
                  node = child[j$];
                  if (that = node.rewriteShorthand(o, assign)) {
                    child[i] = that;
                  }
                }
              } else if (that = child.rewriteShorthand(o, assign)) {
                this[name] = that;
              }
            }
          }
        },
        anaphorize: function() {
          var base, name, ref$2;
          this.children = this.aTargets;
          if (this.eachChild(hasThat)) {
            if ((base = this)[name = this.aSource] instanceof Existence) {
              base[name].doAnaphorize = true;
            } else if (base[name].value !== "that") {
              base[name] = Assign(Var("that"), base[name]);
            }
          }
          function hasThat(it) {
            var that;
            return it.value === "that" || ((that = it.aSource) ? (that = it[that]) ? hasThat(that) : void 0 : it.eachChild(hasThat));
          }
          delete this.children;
          return ref$2 = this[this.aSource], ref$2.cond = true, ref$2;
        },
        carp: function(msg, type) {
          type == null && (type = SyntaxError);
          throw type(msg + " " + this.lineMsg());
        },
        warn: function(msg) {
          if (typeof console != "undefined" && console !== null) {
            console.warn("WARNING: " + msg + " " + this.lineMsg());
          }
        },
        lineMsg: function() {
          return "on line " + (this.line || this.traverseChildren(function(it) {
            return it.line;
          }));
        },
        delegate: function(names, fn) {
          var i$, len$;
          for (i$ = 0, len$ = names.length; i$ < len$; ++i$) {
            fn$.call(this, names[i$]);
          }
          function fn$(name) {
            this[name] = function(it) {
              return fn.call(this, name, it);
            };
          }
        },
        children: [],
        terminator: ";",
        isComplex: YES,
        isStatement: NO,
        isAssignable: NO,
        isCallable: NO,
        isEmpty: NO,
        isArray: NO,
        isString: NO,
        isRegex: NO,
        isMatcher: function() {
          return this.isString() || this.isRegex();
        },
        assigns: NO,
        ripName: VOID,
        getRef: VOID,
        unfoldSoak: VOID,
        unfoldAssign: VOID,
        unparen: THIS,
        unwrap: THIS,
        maybeKey: VOID,
        varName: String,
        getAccessors: VOID,
        getCall: VOID,
        getDefault: VOID,
        getJump: VOID,
        isNextUnreachable: NO,
        extractKeyRef: function(o, assign) {
          return this.maybeKey() || this.carp(assign ? "invalid assign" : "invalid property shorthand");
        },
        invert: function() {
          return Unary("!", this, true);
        },
        invertCheck: function(it) {
          if (it.inverted) {
            return this.invert();
          } else {
            return this;
          }
        },
        addElse: function($else) {
          this["else"] = $else;
          return this;
        },
        makeReturn: function(ref, obj) {
          var items, kv, i, v;
          if (obj) {
            items = this instanceof Arr ? (this.items[0] == null || this.items[1] == null && this.carp("must specify both key and value for object comprehension"), this.items) : (kv = "keyValue$", function() {
              var i$, ref$2, len$, results$ = [];
              for (i$ = 0, len$ = (ref$2 = [Assign(Var(kv), this), Var(kv)]).length; i$ < len$; ++i$) {
                i = i$;
                v = ref$2[i$];
                results$.push(Chain(v).add(Index(Literal(i))));
              }
              return results$;
            }.call(this));
            return Assign(Chain(Var(ref)).add(Index(items[0], ".", true)), items[1]);
          } else if (ref) {
            return Call.make(JS(ref + ".push"), [this]);
          } else {
            return Return(this);
          }
        },
        show: String,
        toString: function(idt) {
          var tree, that;
          idt || (idt = "");
          tree = "\n" + idt + this.constructor.displayName;
          if (that = this.show()) {
            tree += " " + that;
          }
          this.eachChild(function(it) {
            tree += it.toString(idt + TAB);
          });
          return tree;
        },
        stringify: function(space) {
          return JSON.stringify(this, null, space);
        },
        toJSON: function() {
          return import$({
            type: this.constructor.displayName
          }, this);
        }
      };
      exports.parse = function(json) {
        return exports.fromJSON(JSON.parse(json));
      };
      exports.fromJSON = /* @__PURE__ */ (function() {
        function fromJSON(it) {
          var that, node, key, val, i$, len$, v, results$ = [];
          if (!(it && typeof it === "object")) {
            return it;
          }
          if (that = it.type) {
            node = clone$(exports[that].prototype);
            for (key in it) {
              val = it[key];
              node[key] = fromJSON(val);
            }
            return node;
          }
          if (it.length != null) {
            for (i$ = 0, len$ = it.length; i$ < len$; ++i$) {
              v = it[i$];
              results$.push(fromJSON(v));
            }
            return results$;
          } else {
            return it;
          }
        }
        return fromJSON;
      })();
      Negatable = {
        show: function() {
          return this.negated && "!";
        },
        invert: function() {
          this.negated = !this.negated;
          return this;
        }
      };
      exports.Block = Block = (function(superclass) {
        var prototype = extend$((import$(Block2, superclass).displayName = "Block", Block2), superclass).prototype, constructor = Block2;
        function Block2(body) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          body || (body = []);
          if ("length" in body) {
            this$.lines = body;
          } else {
            this$.lines = [];
            this$.add(body);
          }
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Block2.prototype.children = ["lines"];
        Block2.prototype.toJSON = function() {
          delete this.back;
          return superclass.prototype.toJSON.call(this);
        };
        Block2.prototype.add = function(it) {
          var that, ref$2;
          it = it.unparen();
          switch (false) {
            case !(that = this.back):
              that.add(it);
              break;
            case !(that = it.lines):
              (ref$2 = this.lines).push.apply(ref$2, that);
              break;
            default:
              this.lines.push(it);
              if (that = (ref$2 = it.back, delete it.back, ref$2)) {
                this.back = that;
              }
          }
          return this;
        };
        Block2.prototype.prepend = function() {
          var ref$2;
          (ref$2 = this.lines).splice.apply(ref$2, [this.neck(), 0].concat(arrayFrom$(arguments)));
          return this;
        };
        Block2.prototype.pipe = function(target, type) {
          var args;
          args = type === "|>" ? this.lines.pop() : target;
          if (toString$.call(args).slice(8, -1) !== "Array") {
            args = [args];
          }
          switch (type) {
            case "|>":
              this.lines.push(Call.make(target, args, {
                pipe: true
              }));
              break;
            case "<|":
              this.lines.push(Call.make(this.lines.pop(), args));
          }
          return this;
        };
        Block2.prototype.unwrap = function() {
          if (this.lines.length === 1) {
            return this.lines[0];
          } else {
            return this;
          }
        };
        Block2.prototype.chomp = function() {
          var lines, i, that;
          lines = this.lines;
          i = lines.length;
          while (that = lines[--i]) {
            if (!that.comment) {
              break;
            }
          }
          lines.length = i + 1;
          return this;
        };
        Block2.prototype.neck = function() {
          var pos, i$, ref$2, len$, x;
          pos = 0;
          for (i$ = 0, len$ = (ref$2 = this.lines).length; i$ < len$; ++i$) {
            x = ref$2[i$];
            if (!(x.comment || x instanceof Literal)) {
              break;
            }
            ++pos;
          }
          return pos;
        };
        Block2.prototype.isComplex = function() {
          var ref$2;
          return this.lines.length > 1 || ((ref$2 = this.lines[0]) != null ? ref$2.isComplex() : void 0);
        };
        prototype.delegate(["isCallable", "isArray", "isString", "isRegex"], function(it) {
          var ref$2, ref1$;
          return (ref$2 = (ref1$ = this.lines)[ref1$.length - 1]) != null ? ref$2[it]() : void 0;
        });
        Block2.prototype.getJump = function(it) {
          var i$, ref$2, len$, node, that;
          for (i$ = 0, len$ = (ref$2 = this.lines).length; i$ < len$; ++i$) {
            node = ref$2[i$];
            if (that = node.getJump(it)) {
              return that;
            }
          }
        };
        Block2.prototype.isNextUnreachable = function() {
          var i$, ref$2, len$, node;
          for (i$ = 0, len$ = (ref$2 = this.lines).length; i$ < len$; ++i$) {
            node = ref$2[i$];
            if (node.isNextUnreachable()) {
              return true;
            }
          }
          return false;
        };
        Block2.prototype.makeReturn = function() {
          var that, ref$2, key$;
          this.chomp();
          if (that = (ref$2 = this.lines)[key$ = ref$2.length - 1] != null ? ref$2[key$] = (ref$2 = ref$2[key$]).makeReturn.apply(ref$2, arguments) : void 0) {
            if (that instanceof Return && !that.it) {
              --this.lines.length;
            }
          }
          return this;
        };
        Block2.prototype.compile = function(o, level) {
          var tab, codes, i$, ref$2, len$, node, that, code;
          level == null && (level = o.level);
          if (level) {
            return this.compileExpressions(o, level);
          }
          o.block = this;
          tab = o.indent;
          codes = [];
          for (i$ = 0, len$ = (ref$2 = this.lines).length; i$ < len$; ++i$) {
            node = ref$2[i$];
            if (that = node.rewriteShorthand(o)) {
              node = that;
            }
            node = node.unfoldSoak(o) || node;
            if (snEmpty(code = (node.front = true, node).compile(o, level))) {
              continue;
            }
            codes.push(tab);
            codes.push(code);
            node.isStatement() || codes.push(node.terminator);
            codes.push("\n");
          }
          codes.pop();
          return sn.apply(null, [null].concat(arrayFrom$(codes)));
        };
        Block2.prototype.compileRoot = function(options) {
          var o, that, ref$2, bare, prefix, ref1$, ref2$, comment, ref3$, code;
          o = import$({
            level: LEVEL_TOP,
            scope: this.scope = Scope.root = new Scope()
          }, options);
          if (that = (ref$2 = o.saveScope, delete o.saveScope, ref$2)) {
            this.scope = Scope.root = o.scope = that.savedScope || (that.savedScope = o.scope);
          }
          delete o.filename;
          o.indent = (bare = (ref$2 = o.bare, delete o.bare, ref$2)) ? "" : TAB;
          if (/^\s*(?:#!|javascript:)/.test((ref$2 = this.lines[0]) != null ? ref$2.code : void 0)) {
            prefix = this.lines.shift().code + "\n";
          }
          if (((ref1$ = this.lines[0]) != null ? (ref2$ = ref1$.code) != null ? ref2$[0] : void 0 : void 0) === "/") {
            comment = this.lines.shift().code + "\n";
          }
          if ((ref3$ = o.eval, delete o.eval, ref3$) && this.chomp().lines.length) {
            if (bare) {
              this.lines.push(Parens(this.lines.pop()));
            } else {
              this.makeReturn();
            }
          }
          code = [this.compileWithDeclarations(o)];
          bare || (code = ["(function(){\n"].concat(arrayFrom$(code), ["\n}).call(this);\n"]));
          return sn(null, prefix || [], options.header || [], comment || [], code);
        };
        Block2.prototype.compileWithDeclarations = function(o) {
          var pre, i, rest, post, that;
          o.level = LEVEL_TOP;
          pre = [];
          if (i = this.neck()) {
            rest = this.lines.splice(i, 9e9);
            pre = [this.compile(o), "\n"];
            this.lines = rest;
          }
          if (snEmpty(post = this.compile(o))) {
            return sn(this, pre[0] || []);
          }
          return sn.apply(null, [null].concat(arrayFrom$(pre), [(that = this.scope) ? that.emit(post, o.indent) : post]));
        };
        Block2.prototype.compileExpressions = function(o, level) {
          var lines, i, that, line, code, last, i$, len$, node;
          lines = this.chomp().lines;
          i = -1;
          while (that = lines[++i]) {
            if (that.comment) {
              lines.splice(i--, 1);
            }
          }
          if (!lines.length) {
            lines.push(Literal("void"));
          }
          lines[0].front = this.front;
          lines[lines.length - 1]["void"] = this["void"];
          if (!lines[1]) {
            line = lines[0];
            if (that = line.rewriteShorthand(o)) {
              line = that;
            }
            return line.compile(o, level);
          }
          code = [];
          last = lines.pop();
          for (i$ = 0, len$ = lines.length; i$ < len$; ++i$) {
            node = lines[i$];
            if (that = node.rewriteShorthand(o)) {
              node = that;
            }
            code.push((node["void"] = true, node).compile(o, LEVEL_PAREN), ", ");
          }
          if (that = last.rewriteShorthand(o)) {
            last = that;
          }
          code.push(last.compile(o, LEVEL_PAREN));
          if (level < LEVEL_LIST) {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [null, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Block2.prototype.rewriteShorthand = VOID;
        return Block2;
      })(Node);
      Atom = (function(superclass) {
        var prototype = extend$((import$(Atom2, superclass).displayName = "Atom", Atom2), superclass).prototype, constructor = Atom2;
        Atom2.prototype.show = function() {
          return this.value;
        };
        Atom2.prototype.isComplex = NO;
        function Atom2() {
          Atom2.superclass.apply(this, arguments);
        }
        return Atom2;
      })(Node);
      exports.Literal = Literal = (function(superclass) {
        var prototype = extend$((import$(Literal2, superclass).displayName = "Literal", Literal2), superclass).prototype, constructor = Literal2;
        function Literal2(value) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.value = value;
          if (value.js) {
            return JS(value + "", true);
          }
          if (value === "super") {
            return new Super();
          }
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Literal2.prototype.isEmpty = function() {
          var ref$2;
          return (ref$2 = this.value) === "void" || ref$2 === "null";
        };
        Literal2.prototype.isCallable = function() {
          var ref$2;
          return (ref$2 = this.value) === "this" || ref$2 === "eval" || ref$2 === "..";
        };
        Literal2.prototype.isString = function() {
          return 0 <= `'"`.indexOf((this.value + "").charAt());
        };
        Literal2.prototype.isRegex = function() {
          return (this.value + "").charAt() === "/";
        };
        Literal2.prototype.isComplex = function() {
          return this.isRegex() || this.value === "debugger";
        };
        Literal2.prototype.isWhat = function() {
          switch (false) {
            case !this.isEmpty():
              return "empty";
            case !this.isCallable():
              return "callable";
            case !this.isString():
              return "string";
            case !this.isRegex():
              return "regex";
            case !this.isComplex():
              return "complex";
            default:
          }
        };
        Literal2.prototype.varName = function() {
          if (/^\w+$/.test(this.value)) {
            return "$" + this.value;
          } else {
            return "";
          }
        };
        Literal2.prototype.makeReturn = function(it) {
          if (!it && this.value === "debugger") {
            return this;
          } else {
            return superclass.prototype.makeReturn.apply(this, arguments);
          }
        };
        Literal2.prototype.maybeKey = function() {
          var ref$2;
          if (ID.test(this.value)) {
            return Key(this.value, (ref$2 = this.value) !== "arguments" && ref$2 !== "eval");
          } else {
            return this;
          }
        };
        Literal2.prototype.compile = function(o, level) {
          var val, ref$2;
          level == null && (level = o.level);
          switch (val = this.value + "") {
            case "this":
              return sn(this, ((ref$2 = o.scope.fun) != null ? ref$2.bound : void 0) || val);
            case "void":
              if (!level) {
                return sn(this, "");
              }
              val += " 8";
            // fallthrough
            case "null":
              if (level === LEVEL_CALL) {
                this.carp("invalid use of " + this.value);
              }
              break;
            case "on":
            case "yes":
              val = "true";
              break;
            case "off":
            case "no":
              val = "false";
              break;
            case "*":
              this.carp("stray star");
              break;
            case "..":
              if (!(val = o.ref)) {
                this.carp("stray reference");
              }
              this.cascadee || (val.erred = true);
              break;
            case "debugger":
              if (level) {
                return sn(this, "(function(){ debugger; }())");
              }
          }
          return sn(this, snSafe(val));
        };
        return Literal2;
      })(Atom);
      exports.Var = Var = (function(superclass) {
        var prototype = extend$((import$(Var2, superclass).displayName = "Var", Var2), superclass).prototype, constructor = Var2;
        function Var2(value) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.value = value;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        prototype.isAssignable = prototype.isCallable = YES;
        Var2.prototype.assigns = function() {
          return [this.value];
        };
        Var2.prototype.maybeKey = function() {
          var ref$2;
          return ref$2 = Key(this.value), ref$2.line = this.line, ref$2;
        };
        Var2.prototype.varName = prototype.show;
        Var2.prototype.compile = function(o) {
          return sn(this, this.temp ? o.scope.free(this.value) : this.value);
        };
        return Var2;
      })(Atom);
      exports.Key = Key = (function(superclass) {
        var prototype = extend$((import$(Key2, superclass).displayName = "Key", Key2), superclass).prototype, constructor = Key2;
        function Key2(name, reserved) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.reserved = reserved || name.reserved;
          this$.name = "" + name;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Key2.prototype.isComplex = NO;
        Key2.prototype.assigns = function() {
          return [this.name];
        };
        Key2.prototype.maybeKey = THIS;
        Key2.prototype.varName = function() {
          var name;
          name = this.name;
          if (this.reserved || (name === "arguments" || name === "eval")) {
            return "$" + name;
          } else {
            return name;
          }
        };
        Key2.prototype.show = function() {
          if (this.reserved) {
            return "'" + this.name + "'";
          } else {
            return this.name;
          }
        };
        Key2.prototype.compile = function() {
          return sn(this, this.show());
        };
        return Key2;
      })(Node);
      exports.Index = Index = (function(superclass) {
        var prototype = extend$((import$(Index2, superclass).displayName = "Index", Index2), superclass).prototype, constructor = Index2;
        function Index2(key, symbol, init) {
          var k, this$ = this instanceof ctor$ ? this : new ctor$();
          symbol || (symbol = ".");
          if (init && key instanceof Arr) {
            switch (key.items.length) {
              case 1:
                if (!((k = key.items[0]) instanceof Splat)) {
                  key = Parens(k);
                }
            }
          }
          switch (symbol) {
            case "[]":
              this$.vivify = Arr;
              break;
            case "{}":
              this$.vivify = Obj;
              break;
            default:
              if ("=" === symbol.slice(-1)) {
                this$.assign = symbol.slice(1);
              }
          }
          this$.key = key;
          this$.symbol = symbol;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Index2.prototype.children = ["key"];
        Index2.prototype.show = function() {
          return [this.soak ? "?" : void 0] + this.symbol;
        };
        Index2.prototype.isComplex = function() {
          return this.key.isComplex() || this.vivify != null;
        };
        Index2.prototype.varName = function() {
          var ref$2;
          return ((ref$2 = this.key) instanceof Key || ref$2 instanceof Literal) && this.key.varName();
        };
        Index2.prototype.compile = function(o) {
          var code;
          code = this.key.compile(o, LEVEL_PAREN);
          if (this.key instanceof Key && "'" !== code.toString().charAt(0)) {
            return sn(this, ".", code);
          } else {
            return sn(this, "[", code, "]");
          }
        };
        return Index2;
      })(Node);
      exports.Slice = Slice = (function(superclass) {
        var prototype = extend$((import$(Slice2, superclass).displayName = "Slice", Slice2), superclass).prototype, constructor = Slice2;
        function Slice2(arg$) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.type = arg$.type, this$.target = arg$.target, this$.from = arg$.from, this$.to = arg$.to;
          this$.from == null && (this$.from = Literal(0));
          if (this$.to && this$.type === "to") {
            this$.to = Binary("+", this$.to, Literal("1"));
          }
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Slice2.prototype.children = ["target", "from", "to"];
        Slice2.prototype.show = function() {
          return this.type;
        };
        Slice2.prototype.compileNode = function(o) {
          var args;
          if (this.to && this.type === "to") {
            this.to = Binary("||", this.to, Literal("9e9"));
          }
          args = [this.target, this.from];
          if (this.to) {
            args.push(this.to);
          }
          return Chain(Var(util("slice"))).add(Index(Key("call"), ".", true)).add(Call(args)).compile(o);
        };
        return Slice2;
      })(Node);
      exports.Chain = Chain = (function(superclass) {
        var prototype = extend$((import$(Chain2, superclass).displayName = "Chain", Chain2), superclass).prototype, constructor = Chain2;
        function Chain2(head, tails) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          if (!tails && head instanceof Chain2) {
            return head;
          }
          this$.head = head;
          this$.tails = tails || [];
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Chain2.prototype.children = ["head", "tails"];
        Chain2.prototype.add = function(it) {
          var last, ref$2, index, ref1$, bi, logics, call, f;
          if (this.tails.length) {
            last = (ref$2 = this.tails)[ref$2.length - 1];
            if (last instanceof Call && ((ref$2 = last.partialized) != null ? ref$2.length : void 0) === 1 && it.args.length === 1) {
              index = last.partialized[0].head.value;
              delete last.partialized;
              last.args[index] = it.args[0];
              return this;
            }
          }
          if (this.head instanceof Existence) {
            ref1$ = Chain2(this.head.it), this.head = ref1$.head, this.tails = ref1$.tails;
            it.soak = true;
          }
          this.tails.push(it);
          bi = this.head instanceof Parens && this.head.it instanceof Binary && !this.head.it.partial ? this.head.it : this.head instanceof Binary && !this.head.partial ? this.head : void 0;
          if (this.head instanceof Super) {
            if (!this.head.called && it instanceof Call && !it.method) {
              it.method = ".call";
              it.args.unshift(Literal("this"));
              this.head.called = true;
            } else if (!this.tails[1] && ((ref1$ = it.key) != null ? ref1$.name : void 0) === "prototype") {
              this.head.sproto = true;
            }
          } else if (it instanceof Call && this.tails.length === 1 && bi && in$(bi.op, logics = ["&&", "||", "xor"])) {
            call = it;
            f = function(x, key) {
              var y;
              y = x[key];
              if (y instanceof Binary && in$(y.op, logics)) {
                f(y, "first");
                return f(y, "second");
              } else {
                return x[key] = Chain2(y).autoCompare(call.args);
              }
            };
            f(bi, "first");
            f(bi, "second");
            return bi;
          }
          return this;
        };
        Chain2.prototype.autoCompare = function(target) {
          var test;
          if (!this.tails.length) {
            test = this.head;
          }
          switch (false) {
            case !(test instanceof Literal):
              return Binary("===", test, target[0]);
            case !(test instanceof Unary && test.it instanceof Literal):
              return Binary("===", test, target[0]);
            case !(test instanceof Arr || test instanceof Obj):
              return Binary("====", test, target[0]);
            case !(test instanceof Var && test.value === "_"):
              return Literal("true");
            default:
              return this.add(Call(target)) || [];
          }
        };
        Chain2.prototype.flipIt = function() {
          this.flip = true;
          return this;
        };
        Chain2.prototype.unwrap = function() {
          if (this.tails.length) {
            return this;
          } else {
            return this.head;
          }
        };
        prototype.delegate(["getJump", "assigns", "isStatement", "isString"], function(it, arg) {
          return !this.tails.length && this.head[it](arg);
        });
        Chain2.prototype.isComplex = function() {
          return this.tails.length || this.head.isComplex();
        };
        Chain2.prototype.isCallable = function() {
          var that, ref$2;
          if (that = (ref$2 = this.tails)[ref$2.length - 1]) {
            return !((ref$2 = that.key) != null && ref$2.items);
          } else {
            return this.head.isCallable();
          }
        };
        Chain2.prototype.isArray = function() {
          var that, ref$2;
          if (that = (ref$2 = this.tails)[ref$2.length - 1]) {
            return that.key instanceof Arr;
          } else {
            return this.head.isArray();
          }
        };
        Chain2.prototype.isRegex = function() {
          return this.head.value === "RegExp" && !this.tails[1] && this.tails[0] instanceof Call;
        };
        Chain2.prototype.isAssignable = function() {
          var tail, ref$2, i$, len$;
          if (!(tail = (ref$2 = this.tails)[ref$2.length - 1])) {
            return this.head.isAssignable();
          }
          if (!(tail instanceof Index) || tail.key instanceof List || tail.symbol === ".~") {
            return false;
          }
          for (i$ = 0, len$ = (ref$2 = this.tails).length; i$ < len$; ++i$) {
            tail = ref$2[i$];
            if (tail.assign) {
              return false;
            }
          }
          return true;
        };
        Chain2.prototype.isSimpleAccess = function() {
          return this.tails.length === 1 && !this.head.isComplex() && !this.tails[0].isComplex();
        };
        Chain2.prototype.makeReturn = function() {
          var ref$2;
          if (this.tails.length) {
            return superclass.prototype.makeReturn.apply(this, arguments);
          } else {
            return (ref$2 = this.head).makeReturn.apply(ref$2, arguments);
          }
        };
        Chain2.prototype.getCall = function() {
          var tail, ref$2;
          return (tail = (ref$2 = this.tails)[ref$2.length - 1]) instanceof Call && tail;
        };
        Chain2.prototype.varName = function() {
          var ref$2, ref1$;
          return (ref$2 = (ref1$ = this.tails)[ref1$.length - 1]) != null ? ref$2.varName() : void 0;
        };
        Chain2.prototype.cacheReference = function(o) {
          var name, ref$2, base, bref, nref, key;
          name = (ref$2 = this.tails)[ref$2.length - 1];
          if (!this.isAssignable()) {
            return this.unwrap().cache(o, true);
          }
          if (this.tails.length < 2 && !this.head.isComplex() && !(name != null && name.isComplex())) {
            return [this, this];
          }
          base = Chain2(this.head, this.tails.slice(0, -1));
          if (base.isComplex()) {
            ref$2 = base.unwrap().cache(o, true), base = ref$2[0], bref = ref$2[1];
            base = Chain2(base);
          }
          if (!name) {
            return [base, bref];
          }
          nref = name;
          if (name.symbol !== ".") {
            nref = name;
            name = Index(name.key, ".");
          }
          if (name.isComplex()) {
            ref$2 = name.key.unwrap().cache(o, true, void 0, "key"), key = ref$2[0], nref.key = ref$2[1];
            name = Index(key);
          }
          return [base.add(name), Chain2(bref || base.head, [nref])];
        };
        Chain2.prototype.compileNode = function(o) {
          var head, tails, that, i$, len$, t, hasPartial, pre, rest, broken, partial, post, context, idt, func, base, news, ref$2;
          if (this.flip) {
            util("flip");
            util("curry");
          }
          head = this.head, tails = this.tails;
          head.front = this.front;
          head.newed = this.newed;
          if (!tails.length) {
            return head.compile(o);
          }
          if (that = this.unfoldAssign(o)) {
            return that.compile(o);
          }
          for (i$ = 0, len$ = tails.length; i$ < len$; ++i$) {
            t = tails[i$];
            if (t.partialized) {
              hasPartial = true;
              break;
            }
          }
          if (hasPartial) {
            util("slice");
            pre = [];
            rest = [];
            for (i$ = 0, len$ = tails.length; i$ < len$; ++i$) {
              t = tails[i$];
              broken = broken || t.partialized != null;
              if (broken) {
                rest.push(t);
              } else {
                pre.push(t);
              }
            }
            if (rest != null) {
              partial = rest[0], post = slice$.call(rest, 1);
            }
            this.tails = pre;
            context = pre.length ? Chain2(head, slice$.call(pre, 0, -1)) : Literal("this");
            return Chain2(Chain2(Var(util("partialize"))).add(Index(Key("apply"))).add(Call([context, Arr([this, Arr(partial.args), Arr(partial.partialized)])])), post).compile(o);
          }
          if (tails[0] instanceof Call && !head.isCallable()) {
            this.carp("invalid callee");
          }
          this.expandVivify();
          this.expandBind(o);
          this.expandSplat(o);
          this.expandStar(o);
          if (this.splattedNewArgs) {
            idt = o.indent + TAB;
            func = Chain2(this.head, tails.slice(0, -1));
            return sn(null, "(function(func, args, ctor) {\n" + idt + "ctor.prototype = func.prototype;\n" + idt + "var child = new ctor, result = func.apply(child, args), t;\n" + idt + 'return (t = typeof result)  == "object" || t == "function" ? result || child : child;\n' + TAB + "})(", func.compile(o), ", ", this.splattedNewArgs, ", function(){})");
          }
          if (!this.tails.length) {
            return this.head.compile(o);
          }
          base = [this.head.compile(o, LEVEL_CALL)];
          news = [];
          rest = [];
          for (i$ = 0, len$ = (ref$2 = this.tails).length; i$ < len$; ++i$) {
            t = ref$2[i$];
            if (t["new"]) {
              news.push("new ");
            }
            rest.push(t.compile(o));
          }
          if ("." === rest.join("").charAt(0) && SIMPLENUM.test(base[0].toString())) {
            base.push(" ");
          }
          return sn.apply(null, [null].concat(arrayFrom$(news), arrayFrom$(base), arrayFrom$(rest)));
        };
        Chain2.prototype.unfoldSoak = function(o) {
          var that, ref$2, i$, len$, i, node, ref1$, bust, test;
          if (that = this.head.unfoldSoak(o)) {
            (ref$2 = that.then.tails).push.apply(ref$2, this.tails);
            return that;
          }
          for (i$ = 0, len$ = (ref$2 = this.tails).length; i$ < len$; ++i$) {
            i = i$;
            node = ref$2[i$];
            if (ref1$ = node.soak, delete node.soak, ref1$) {
              bust = Chain2(this.head, this.tails.splice(0, i));
              if (node.assign && !bust.isAssignable()) {
                node.carp("invalid accessign");
              }
              if (i && (node.assign || node instanceof Call)) {
                ref1$ = bust.cacheReference(o), test = ref1$[0], bust = ref1$[1];
                if (bust instanceof Chain2) {
                  (ref1$ = this.tails).unshift.apply(ref1$, bust.tails);
                  bust = bust.head;
                }
                this.head = bust;
              } else {
                ref1$ = bust.unwrap().cache(o), test = ref1$[0], this.head = ref1$[1];
              }
              test = node instanceof Call ? JS("typeof " + test.compile(o, LEVEL_OP) + " == 'function'") : Existence(test);
              return ref1$ = If(test, this), ref1$.soak = true, ref1$.cond = this.cond, ref1$["void"] = this["void"], ref1$;
            }
          }
        };
        Chain2.prototype.unfoldAssign = function(o) {
          var that, ref$2, i$, len$, i, index, op, left, lefts, rites, j$, len1$, node, ref1$;
          if (that = this.head.unfoldAssign(o)) {
            (ref$2 = that.right.tails).push.apply(ref$2, this.tails);
            return that;
          }
          for (i$ = 0, len$ = (ref$2 = this.tails).length; i$ < len$; ++i$) {
            i = i$;
            index = ref$2[i$];
            if (op = index.assign) {
              index.assign = "";
              left = Chain2(this.head, this.tails.splice(0, i)).unwrap();
              if (left instanceof Arr) {
                lefts = left.items;
                rites = (this.head = Arr()).items;
                for (j$ = 0, len1$ = lefts.length; j$ < len1$; ++j$) {
                  i = j$;
                  node = lefts[j$];
                  ref1$ = Chain2(node).cacheReference(o), rites[i] = ref1$[0], lefts[i] = ref1$[1];
                }
              } else {
                ref1$ = Chain2(left).cacheReference(o), left = ref1$[0], this.head = ref1$[1];
              }
              if (op === "=") {
                op = ":=";
              }
              return ref1$ = Assign(left, this, op), ref1$.access = true, ref1$;
            }
          }
        };
        Chain2.prototype.expandSplat = function(o) {
          var tails, i, call, args, ctx, ref$2;
          tails = this.tails;
          i = -1;
          while (call = tails[++i]) {
            if (!(args = call.args)) {
              continue;
            }
            ctx = call.method === ".call" && (args = args.concat()).shift();
            if (!!snEmpty(args = Splat.compileArray(o, args, true))) {
              continue;
            }
            if (call["new"]) {
              this.splattedNewArgs = args;
            } else {
              if (!ctx && tails[i - 1] instanceof Index) {
                ref$2 = Chain2(this.head, tails.splice(0, i - 1)).cache(o, true), this.head = ref$2[0], ctx = ref$2[1];
                i = 0;
              }
              call.method = ".apply";
              call.args = [ctx || Literal("null"), JS(args)];
            }
          }
        };
        Chain2.prototype.expandVivify = function() {
          var tails, i, that, ref$2, ref1$;
          tails = this.tails;
          i = 0;
          while (i < tails.length) {
            if (that = (ref1$ = (ref$2 = tails[i++]).vivify, delete ref$2.vivify, ref1$)) {
              this.head = Assign(Chain2(this.head, tails.splice(0, i)), that(), "=", "||");
              i = 0;
            }
          }
        };
        Chain2.prototype.expandBind = function(o) {
          var tails, i, that, obj, key, call;
          tails = this.tails;
          i = -1;
          while (that = tails[++i]) {
            if (that.symbol !== ".~") {
              continue;
            }
            that.symbol = "";
            obj = Chain2(this.head, tails.splice(0, i)).unwrap();
            key = tails.shift().key;
            call = Call.make(Util("bind"), [obj, (key.reserved = true, key)]);
            this.head = this.newed ? Parens(call, true) : call;
            i = -1;
          }
        };
        Chain2.prototype.expandStar = function(o) {
          var tails, i, that, stars, ref$2, sub, ref, temps, value, i$, len$, star;
          tails = this.tails;
          i = -1;
          while (that = tails[++i]) {
            if (that.args || that.stars || that.key instanceof Key) {
              continue;
            }
            stars = that.stars = [];
            that.eachChild(seek);
            if (!stars.length) {
              continue;
            }
            ref$2 = Chain2(this.head, tails.splice(0, i)).unwrap().cache(o), sub = ref$2[0], ref = ref$2[1], temps = ref$2[2];
            value = Chain2(ref, [Index(Key("length"))]).compile(o);
            for (i$ = 0, len$ = stars.length; i$ < len$; ++i$) {
              star = stars[i$];
              star.value = value;
              star.isAssignable = YES;
            }
            this.head = JS(sub.compile(o, LEVEL_CALL) + tails.shift().compile(o));
            if (temps) {
              o.scope.free(temps[0]);
            }
            i = -1;
          }
          function seek(it) {
            if (it.value === "*") {
              stars.push(it);
            } else if (!(it instanceof Index)) {
              it.eachChild(seek);
            }
          }
        };
        Chain2.prototype.rewriteShorthand = function(o, assign) {
          var that, i$, ref$2, len$, i, item;
          if (that = this.head.rewriteShorthand(o)) {
            this.head = that;
          }
          for (i$ = 0, len$ = (ref$2 = this.tails).length; i$ < len$; ++i$) {
            i = i$;
            item = ref$2[i$];
            if (that = item.rewriteShorthand(o, assign)) {
              this.tails[i] = that;
            }
          }
          this.expandSlice(o, assign);
          return this.unwrap();
        };
        Chain2.prototype.expandSlice = function(o, assign) {
          var tails, i, tail, ref$2, x;
          tails = this.tails;
          i = -1;
          while (tail = tails[++i]) {
            if ((ref$2 = tail.key) != null && ref$2.items) {
              if (tails[i + 1] instanceof Call) {
                tail.carp("calling a slice");
              }
              x = tails.splice(0, i + 1);
              x = x.pop().key.toSlice(o, Chain2(this.head, x).unwrap(), tail.symbol, assign);
              this.head = (x.front = this.front, x);
              i = -1;
            }
          }
          return this;
        };
        Chain2.prototype.extractKeyRef = function(o, assign) {
          var ref$2, ref1$;
          return ((ref$2 = (ref1$ = this.tails)[ref1$.length - 1]) != null ? (ref1$ = ref$2.key) != null ? ref1$.extractKeyRef(o, assign) : void 0 : void 0) || superclass.prototype.extractKeyRef.apply(this, arguments);
        };
        return Chain2;
      })(Node);
      exports.Call = Call = (function(superclass) {
        var prototype = extend$((import$(Call2, superclass).displayName = "Call", Call2), superclass).prototype, constructor = Call2;
        function Call2(args) {
          var splat, i$, len$, i, a, ref$2, this$ = this instanceof ctor$ ? this : new ctor$();
          args || (args = []);
          if (args.length === 1 && (splat = args[0]) instanceof Splat) {
            if (splat.filler) {
              this$.method = ".call";
              args[0] = Literal("this");
              args[1] = Splat(Literal("arguments"));
            } else if (splat.it instanceof Arr) {
              args = splat.it.items;
            }
          } else {
            for (i$ = 0, len$ = args.length; i$ < len$; ++i$) {
              i = i$;
              a = args[i$];
              if (a.value === "_") {
                args[i] = Chain(Literal("void"));
                args[i].placeholder = true;
                ((ref$2 = this$.partialized) != null ? ref$2 : this$.partialized = []).push(Chain(Literal(i)));
              }
            }
          }
          this$.args = args;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Call2.prototype.children = ["args"];
        Call2.prototype.show = function() {
          return [this["new"]] + [this.method] + [this.soak ? "?" : void 0];
        };
        Call2.prototype.compile = function(o) {
          var code, i$, ref$2, len$, i, a;
          code = [sn(this, this.method || "", "(") + (this.pipe ? "\n" + o.indent : "")];
          for (i$ = 0, len$ = (ref$2 = this.args).length; i$ < len$; ++i$) {
            i = i$;
            a = ref$2[i$];
            code.push(i ? ", " : "", a.compile(o, LEVEL_LIST));
          }
          code.push(sn(this, ")"));
          return sn.apply(null, [null].concat(arrayFrom$(code)));
        };
        Call2.make = function(callee, args, opts) {
          var call;
          call = Call2(args);
          if (opts) {
            import$(call, opts);
          }
          return Chain(callee).add(call);
        };
        Call2.block = function(fun, args, method) {
          var ref$2, ref1$;
          return ref$2 = Parens(Chain(fun, [(ref1$ = Call2(args), ref1$.method = method, ref1$)]), true), ref$2.calling = true, ref$2;
        };
        Call2.back = function(params, node, bound, curried, hushed, generator) {
          var fun, ref$2, args, index, i$, len$, a;
          fun = Fun(params, void 0, bound, curried, hushed, generator);
          if (node instanceof Label) {
            fun.name = node.label;
            fun.labeled = true;
            node = node.it;
          }
          if (!fun.hushed && (fun.hushed = node.op === "!")) {
            node = node.it;
          }
          if ((ref$2 = node.getCall()) != null) {
            ref$2.partialized = null;
          }
          args = (node.getCall() || (node = Chain(node).add(Call2())).getCall()).args;
          index = 0;
          for (i$ = 0, len$ = args.length; i$ < len$; ++i$) {
            a = args[i$];
            if (a.placeholder) {
              break;
            }
            ++index;
          }
          return node.back = (args[index] = fun).body, node;
        };
        Call2["let"] = function(args, body) {
          var hasYield, hasAwait, params, res$, i$, len$, i, a, that, gotThis;
          hasYield = false;
          hasAwait = false;
          body.traverseChildren(function(child) {
            if (child instanceof Yield) {
              switch (child.op) {
                case "yield":
                case "yieldfrom":
                  hasYield = true;
                  break;
                case "await":
                  hasAwait = true;
              }
            }
            if (hasYield && hasAwait) {
              return true;
            }
          });
          res$ = [];
          for (i$ = 0, len$ = args.length; i$ < len$; ++i$) {
            i = i$;
            a = args[i$];
            if (that = a.op === "=" && !a.logic && a.right) {
              args[i] = that;
              if (i === 0 && (gotThis = a.left.value === "this")) {
                continue;
              }
              res$.push(a.left);
            } else {
              res$.push(Var(a.varName() || a.carp('invalid "let" argument')));
            }
          }
          params = res$;
          gotThis || args.unshift(Literal("this"));
          body = this.block(Fun(params, body, null, null, null, hasYield, hasAwait), args, ".call");
          if (hasYield || hasAwait) {
            return Block(Yield(hasYield ? "yieldfrom" : "await", body));
          } else {
            return body;
          }
        };
        return Call2;
      })(Node);
      List = (function(superclass) {
        var prototype = extend$((import$(List2, superclass).displayName = "List", List2), superclass).prototype, constructor = List2;
        List2.prototype.children = ["items"];
        List2.prototype.show = function() {
          return this.name;
        };
        List2.prototype.named = function(name) {
          this.name = name;
          return this;
        };
        List2.prototype.isEmpty = function() {
          return !this.items.length;
        };
        List2.prototype.assigns = function() {
          var x$, res$, i$, ref$2, len$, node, that, j$, len1$, x;
          res$ = [];
          for (i$ = 0, len$ = (ref$2 = this.items).length; i$ < len$; ++i$) {
            node = ref$2[i$];
            if (that = node.assigns()) {
              for (j$ = 0, len1$ = that.length; j$ < len1$; ++j$) {
                x = that[j$];
                res$.push(x);
              }
            }
          }
          x$ = res$;
          if (that = this.name) {
            x$.push(that);
          }
          return x$;
        };
        List2.compile = function(o, items, deepEq) {
          var indent, level, code, i, that, target;
          switch (items.length) {
            case 0:
              return "";
            case 1:
              return items[0].compile(o, LEVEL_LIST);
          }
          indent = o.indent, level = o.level;
          o.indent = indent + TAB;
          o.level = LEVEL_LIST;
          code = [items[i = 0].compile(o)];
          while (that = items[++i]) {
            code.push(", ");
            target = that;
            if (deepEq) {
              if (target instanceof Var && target.value === "_") {
                target = Obj([Prop(Key("__placeholder__"), Literal(true))]);
              } else if (target instanceof Obj || target instanceof Arr) {
                target.deepEq = true;
              }
            }
            code.push(target.compile(o));
          }
          if (~code.join("").indexOf("\n")) {
            code = ["\n" + o.indent].concat(arrayFrom$(code), ["\n" + indent]);
          }
          o.indent = indent;
          o.level = level;
          return sn.apply(null, [this].concat(arrayFrom$(code)));
        };
        List2.prototype.toSlice = function(o, base, symbol, assign) {
          var items, isObj, ref$2, ref, temps, i$, len$, i, item, val, splat, chain;
          items = this.items;
          isObj = this instanceof Obj;
          if (items.length > 1) {
            ref$2 = base.cache(o), base = ref$2[0], ref = ref$2[1], temps = ref$2[2];
          } else {
            ref = base;
          }
          for (i$ = 0, len$ = items.length; i$ < len$; ++i$) {
            i = i$;
            item = items[i$];
            if (!item.comment) {
              if (isObj) {
                val = item.val;
                if (!(val instanceof List2)) {
                  (val = val.maybeKey()) || this.carp("value in object slice is not a key");
                }
              } else {
                val = item;
                if (splat = val instanceof Splat) {
                  val = val.it;
                }
                if (val.isEmpty()) {
                  continue;
                }
              }
              chain = val instanceof List2 ? val.toSlice(o, base, symbol, assign) : Chain(base, [Index(val, symbol)]);
              if (isObj) {
                item.val = chain;
              } else {
                items[i] = splat ? Splat(chain) : chain;
              }
              base = ref;
            }
          }
          chain || this.carp("empty slice");
          if (temps) {
            (this.temps || (this.temps = [])).push(temps[0]);
          }
          return this;
        };
        List2.prototype.extractKeyRef = function() {
          var that;
          if ((that = this.name) != null) {
            return Key(that);
          } else {
            return superclass.prototype.extractKeyRef.apply(this, arguments);
          }
        };
        function List2() {
          List2.superclass.apply(this, arguments);
        }
        return List2;
      })(Node);
      exports.Obj = Obj = (function(superclass) {
        var prototype = extend$((import$(Obj2, superclass).displayName = "Obj", Obj2), superclass).prototype, constructor = Obj2;
        function Obj2(items) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.items = items || [];
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Obj2.prototype.asObj = THIS;
        Obj2.prototype.compileNode = function(o) {
          var items, code, idt, dic, i$, len$, i, node, ref$2, rest, multi, key, val;
          if (this.name != null) {
            this.carp("unexpected label");
          }
          items = this.items;
          if (!items.length) {
            return sn(this, this.front ? "({})" : "{}");
          }
          code = [];
          idt = "\n" + (o.indent += TAB);
          dic = {};
          for (i$ = 0, len$ = items.length; i$ < len$; ++i$) {
            i = i$;
            node = items[i$];
            if (node.comment) {
              code.push(idt, node.compile(o));
              continue;
            }
            if ((ref$2 = node.key) instanceof Splat || ref$2 instanceof Parens) {
              rest = items.slice(i);
              break;
            }
            if (node.logic) {
              node.val = (ref$2 = node.logic, ref$2.first = node.val, ref$2);
            }
            if (this.deepEq) {
              if (node.val instanceof Var && node.val.value === "_") {
                node.val = Obj2([Prop(Key("__placeholder__"), Literal(true))]);
              } else if ((ref$2 = node.val) instanceof Obj2 || ref$2 instanceof Arr) {
                node.val.deepEq = true;
              }
            }
            if (multi) {
              code.push(",");
            } else {
              multi = true;
            }
            code.push(idt);
            key = node.key, val = node.val;
            if (node.accessor) {
              code.push(node.compileAccessor(o, key = key.compile(o)));
            } else {
              val.ripName(key);
              code.push(key = key.compile(o), ": ", val.compile(o, LEVEL_LIST));
            }
            ID.test(key) || (key = Function("return " + key)());
            if (!(dic[key + "."] ^= 1)) {
              node.carp('duplicate property "' + key + '"');
            }
          }
          if (code.join("")) {
            code.push("\n" + this.tab);
          }
          code = sn.apply(null, [null, sn(this, "{")].concat(arrayFrom$(code), [sn(this, "}")]));
          rest && (code = Import(JS(code), Obj2(rest)).compile((o.indent = this.tab, o)));
          if (this.front && "{" === code.toString().charAt()) {
            return sn(null, "(", code, ")");
          } else {
            return code;
          }
        };
        return Obj2;
      })(List);
      exports.Prop = Prop = (function(superclass) {
        var prototype = extend$((import$(Prop2, superclass).displayName = "Prop", Prop2), superclass).prototype, constructor = Prop2;
        function Prop2(key, val) {
          var that, i$, len$, fun, this$ = this instanceof ctor$ ? this : new ctor$();
          this$.key = key;
          this$.val = val;
          if ((key != null ? key.value : void 0) === "...") {
            this$.key = Splat();
          }
          if (that = val.getAccessors()) {
            this$.val = that;
            for (i$ = 0, len$ = that.length; i$ < len$; ++i$) {
              fun = that[i$];
              fun.x = (fun.hushed = fun.params.length) ? "s" : "g";
            }
            this$["accessor"] = "accessor";
          }
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Prop2.prototype.children = ["key", "val", "logic"];
        Prop2.prototype.show = function() {
          return this.accessor;
        };
        Prop2.prototype.assigns = function() {
          var ref$2;
          return typeof (ref$2 = this.val).assigns == "function" ? ref$2.assigns() : void 0;
        };
        Prop2.prototype.compileAccessor = function(o, key) {
          var funs, code, i$, len$, fun;
          funs = this.val;
          if (funs[1] && funs[0].params.length + funs[1].params.length !== 1) {
            funs[0].carp("invalid accessor parameter");
          }
          code = [];
          for (i$ = 0, len$ = funs.length; i$ < len$; ++i$) {
            fun = funs[i$];
            fun.accessor = true;
            code.push(fun.x, "et ", key, fun.compile(o, LEVEL_LIST).toString().slice(8), ",\n" + o.indent);
          }
          code.pop();
          return sn.apply(null, [null].concat(arrayFrom$(code)));
        };
        Prop2.prototype.compileDescriptor = function(o) {
          var obj, i$, ref$2, len$, fun;
          obj = Obj();
          for (i$ = 0, len$ = (ref$2 = this.val).length; i$ < len$; ++i$) {
            fun = ref$2[i$];
            obj.items.push(Prop2(Key(fun.x + "et"), fun));
          }
          obj.items.push(Prop2(Key("configurable"), Literal(true)));
          obj.items.push(Prop2(Key("enumerable"), Literal(true)));
          return obj.compile(o);
        };
        Prop2.prototype.rewriteShorthand = function(o, assign) {
          var ref$2, that;
          superclass.prototype.rewriteShorthand.apply(this, arguments);
          if (this.key == null && this.val instanceof Assign) {
            this.val = this.val.maybeLogic();
          }
          if (this.key == null && this.val instanceof Unary && ((ref$2 = this.val.op) === "+" || ref$2 === "-")) {
            this.key = this.val.it.maybeKey() || this.carp("invalid property flag shorthand");
            this.val = Literal(this.val.op === "+");
          }
          if (that = this.val instanceof Binary && this.val.getDefault()) {
            this.val = this.val.first;
            this.logic = (that.first = null, that);
          }
          this.key == null && (this.key = this.val.extractKeyRef(o, assign));
        };
        return Prop2;
      })(Node);
      exports.Arr = Arr = (function(superclass) {
        var prototype = extend$((import$(Arr2, superclass).displayName = "Arr", Arr2), superclass).prototype, constructor = Arr2;
        function Arr2(items) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.items = items || [];
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Arr2.prototype.isArray = YES;
        Arr2.prototype.asObj = function() {
          var i, item;
          return Obj(function() {
            var i$, ref$2, len$, results$ = [];
            for (i$ = 0, len$ = (ref$2 = this.items).length; i$ < len$; ++i$) {
              i = i$;
              item = ref$2[i$];
              results$.push(Prop(Literal(i), item));
            }
            return results$;
          }.call(this));
        };
        Arr2.prototype.compile = function(o) {
          var items, code;
          if (this.name != null) {
            this.carp("unexpected label");
          }
          items = this.items;
          if (!items.length) {
            return sn(this, "[]");
          }
          if (!snEmpty(code = Splat.compileArray(o, items))) {
            return this.newed ? sn(this, "(", code, ")") : sn(this, code);
          }
          return sn(null, sn(this, "["), List.compile(o, items, this.deepEq), sn(this, "]"));
        };
        Arr2.maybe = function(nodes) {
          if (nodes.length === 1 && !(nodes[0] instanceof Splat)) {
            return nodes[0];
          }
          return constructor(nodes);
        };
        Arr2.wrap = function(it) {
          return constructor([Splat((it.isArray = YES, it))]);
        };
        return Arr2;
      })(List);
      exports.Yield = Yield = (function(superclass) {
        var prototype = extend$((import$(Yield2, superclass).displayName = "Yield", Yield2), superclass).prototype, constructor = Yield2;
        function Yield2(op, it) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.op = op;
          this$.it = it;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Yield2.prototype.children = ["it"];
        Yield2.prototype.show = function() {
          switch (this.op) {
            case "yield":
              return "";
            case "yieldfrom":
              return "from";
            case "await":
              return "await";
          }
        };
        prototype.delegate(["isCallable"], function() {
          return true;
        });
        Yield2.prototype.compileNode = function(o) {
          var code;
          code = [function() {
            switch (this.op) {
              case "yield":
                return "yield";
              case "yieldfrom":
                return "yield*";
              case "await":
                return "await";
            }
          }.call(this)];
          if (this.it) {
            code.push(" " + this.it.compile(o, LEVEL_OP + PREC.unary));
          }
          return sn.apply(null, [this, "("].concat(arrayFrom$(code), [")"]));
        };
        return Yield2;
      })(Node);
      exports.Unary = Unary = (function(superclass) {
        var prototype = extend$((import$(Unary2, superclass).displayName = "Unary", Unary2), superclass).prototype, constructor = Unary2;
        function Unary2(op, it, flag) {
          var that, i$, ref$2, len$, node, this$ = this instanceof ctor$ ? this : new ctor$();
          if (it != null) {
            if (that = !flag && it.unaries) {
              that.push(op);
              return it;
            }
            switch (op) {
              case "!":
                if (flag) {
                  break;
                }
                if (it instanceof Fun && !it.hushed) {
                  return it.hushed = true, it;
                }
                return it.invert();
              case "++":
              case "--":
                if (flag) {
                  this$.post = true;
                }
                break;
              case "new":
                if (it instanceof Existence && !it.negated) {
                  it = Chain(it).add(Call());
                }
                it.newed = true;
                for (i$ = 0, len$ = (ref$2 = it.tails || "").length; i$ < len$; ++i$) {
                  node = ref$2[i$];
                  if (node instanceof Call && !node["new"]) {
                    if (node.method === ".call") {
                      node.args.shift();
                    }
                    node["new"] = "new";
                    node.method = "";
                    return it;
                  }
                }
                break;
              case "~":
                if (it instanceof Fun && it.statement && !it.bound) {
                  return it.bound = "this$", it;
                }
            }
          }
          this$.op = op;
          this$.it = it;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Unary2.prototype.children = ["it"];
        Unary2.prototype.show = function() {
          return [this.post ? "@" : void 0] + this.op;
        };
        Unary2.prototype.isCallable = function() {
          var ref$2;
          return (ref$2 = this.op) === "do" || ref$2 === "new" || ref$2 === "delete" || this.it == null;
        };
        Unary2.prototype.isArray = function() {
          return this.it instanceof Arr && this.it.items.length || this.it instanceof Chain && this.it.isArray();
        };
        Unary2.prototype.isString = function() {
          var ref$2;
          return (ref$2 = this.op) === "typeof" || ref$2 === "classof";
        };
        Unary2.prototype.invert = function() {
          var ref$2;
          if (this.op === "!" && ((ref$2 = this.it.op) === "!" || ref$2 === "<" || ref$2 === ">" || ref$2 === "<=" || ref$2 === ">=" || ref$2 === "of" || ref$2 === "instanceof")) {
            return this.it;
          }
          return constructor("!", this, true);
        };
        Unary2.prototype.unfoldSoak = function(o) {
          var ref$2;
          return ((ref$2 = this.op) === "++" || ref$2 === "--" || ref$2 === "delete") && this.it != null && If.unfoldSoak(o, this, "it");
        };
        Unary2.prototype.getAccessors = function() {
          var items;
          if (this.op !== "~") {
            return;
          }
          if (this.it instanceof Fun) {
            return [this.it];
          }
          if (this.it instanceof Arr) {
            items = this.it.items;
            if (!items[2] && items[0] instanceof Fun && items[1] instanceof Fun) {
              return items;
            }
          }
        };
        function crement(it) {
          return {
            "++": "in",
            "--": "de"
          }[it] + "crement";
        }
        Unary2.prototype.compileNode = function(o) {
          var that, op, it, x, code;
          if (this.it == null) {
            return this.compileAsFunc(o);
          }
          if (that = this.compileSpread(o)) {
            return that;
          }
          op = this.op, it = this.it;
          switch (op) {
            case "!":
              it.cond = true;
              break;
            case "new":
              it.isCallable() || it.carp("invalid constructor");
              break;
            case "do":
              if (o.level === LEVEL_TOP && it instanceof Fun && it.isStatement()) {
                return sn(this, it.compile(o), " ", Unary2("do", Var(it.name)).compile(o));
              }
              x = Parens(it instanceof Existence && !it.negated ? Chain(it).add(Call()) : Call.make(it));
              return sn(this, (x.front = this.front, x.newed = this.newed, x).compile(o));
            case "delete":
              if (it instanceof Var || !it.isAssignable()) {
                this.carp("invalid delete");
              }
              if (o.level && !this["void"]) {
                return this.compilePluck(o);
              }
              break;
            case "++":
            case "--":
              it.isAssignable() || this.carp("invalid " + crement(op));
              if (that = it instanceof Var && o.scope.checkReadOnly(it.value)) {
                this.carp(crement(op) + " of " + that + ' "' + it.value + '"', ReferenceError);
              }
              if (this.post) {
                it.front = this.front;
              }
              break;
            case "^^":
              return sn(this, util("clone"), "(", it.compile(o, LEVEL_LIST), ")");
            case "jsdelete":
              return sn(this, "delete ", it.compile(o, LEVEL_LIST));
            case "classof":
              return sn(this, util("toString"), ".call(", it.compile(o, LEVEL_LIST), ").slice(8, -1)");
          }
          code = [it.compile(o, LEVEL_OP + PREC.unary)];
          if (this.post) {
            code.push(op);
          } else {
            if (op === "new" || op === "typeof" || op === "delete" || (op === "+" || op === "-") && op === code.join("").charAt()) {
              op += " ";
            }
            code.unshift(op);
          }
          if (o.level < LEVEL_CALL) {
            return sn.apply(null, [this].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [this, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Unary2.prototype.compileSpread = function(o) {
          var it, ops;
          it = this.it;
          ops = [this];
          for (; it instanceof constructor; it = it.it) {
            ops.push(it);
          }
          if (!(it instanceof Splat && (it = it.it) instanceof List)) {
            return "";
          }
          return this.compileSpreadOver(o, it, function(node) {
            var i$, ref$2, op;
            for (i$ = (ref$2 = ops).length - 1; i$ >= 0; --i$) {
              op = ref$2[i$];
              node = constructor(op.op, node, op.post);
            }
            return node;
          });
        };
        Unary2.prototype.compilePluck = function(o) {
          var ref$2, get, del, code, ref;
          ref$2 = Chain(this.it).cacheReference(o), get = ref$2[0], del = ref$2[1];
          code = [ref = o.scope.temporary(), " = ", get.compile(o, LEVEL_LIST), ", delete ", del.compile(o, LEVEL_LIST), ", ", o.scope.free(ref)];
          if (o.level < LEVEL_LIST) {
            return sn.apply(null, [this].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [this, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Unary2.prototype.compileAsFunc = function(o) {
          if (this.op === "!") {
            return sn(this, util("not"));
          } else {
            return sn(this, "(", Fun([], Block(Unary2(this.op, Chain(Var("it"))))).compile(o), ")");
          }
        };
        return Unary2;
      })(Node);
      exports.Binary = Binary = (function(superclass) {
        var COMPARER, INVERSIONS, prototype = extend$((import$(Binary2, superclass).displayName = "Binary", Binary2), superclass).prototype, constructor = Binary2;
        function Binary2(op, first, second) {
          var ref$2, this$ = this instanceof ctor$ ? this : new ctor$();
          this$.partial = first == null || second == null;
          if (!this$.partial) {
            if ("=" === op.charAt(op.length - 1) && ((ref$2 = op.charAt(op.length - 2)) !== "=" && ref$2 !== "<" && ref$2 !== ">" && ref$2 !== "!")) {
              return Assign(first.unwrap(), second, op);
            }
            switch (op) {
              case "in":
                return new In(first, second);
              case "with":
                return new Import(Unary("^^", first), second, false);
              case "<<<":
              case "<<<<":
                return Import(first, second, op === "<<<<");
              case "<|":
                return Block(first).pipe(second, op);
              case "|>":
                return Block(second).pipe(first, "<|");
              case ".":
              case ".~":
                return Chain(first).add(Index(second, op));
            }
          }
          this$.op = op;
          this$.first = first;
          this$.second = second;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Binary2.prototype.children = ["first", "second"];
        Binary2.prototype.show = function() {
          return this.op;
        };
        Binary2.prototype.isCallable = function() {
          var ref$2;
          return this.partial || ((ref$2 = this.op) === "&&" || ref$2 === "||" || ref$2 === "?" || ref$2 === "<<" || ref$2 === ">>") && this.first.isCallable() && this.second.isCallable();
        };
        Binary2.prototype.isArray = function() {
          switch (this.op) {
            case "*":
              return this.first.isArray();
            case "/":
              return this.second.isMatcher();
          }
        };
        Binary2.prototype.isString = function() {
          switch (this.op) {
            case "+":
            case "*":
              return this.first.isString() || this.second.isString();
            case "-":
              return this.second.isMatcher();
          }
        };
        COMPARER = /^(?:[!=]=|[<>])=?$/;
        INVERSIONS = {
          "===": "!==",
          "!==": "===",
          "==": "!=",
          "!=": "=="
        };
        Binary2.prototype.invert = function() {
          var that;
          if (that = !COMPARER.test(this.second.op) && INVERSIONS[this.op]) {
            this.op = that;
            this.wasInverted = true;
            return this;
          }
          return Unary("!", Parens(this), true);
        };
        Binary2.prototype.invertIt = function() {
          this.inverted = true;
          return this;
        };
        Binary2.prototype.getDefault = function() {
          switch (this.op) {
            case "?":
            case "||":
            case "&&":
              return this;
          }
        };
        Binary2.prototype.xorChildren = function(test) {
          var ref$2, first;
          if (!(!(first = test(this.first)) !== !(ref$2 = test(this.second)) && (first || ref$2))) {
            return false;
          }
          return first ? [this.first, this.second] : [this.second, this.first];
        };
        Binary2.prototype.compileNode = function(o) {
          var top, rite, items, that, ref$2, code, level;
          if (this.partial) {
            return this.compilePartial(o);
          }
          switch (this.op) {
            case "?":
              return this.compileExistence(o);
            case "*":
              if (this.second.isString()) {
                return this.compileJoin(o);
              }
              if (this.first.isString() || this.first.isArray()) {
                return this.compileRepeat(o);
              }
              break;
            case "-":
              if (this.second.isMatcher()) {
                return this.compileRemove(o);
              }
              break;
            case "/":
              if (this.second.isMatcher()) {
                return this.compileSplit(o);
              }
              break;
            case "**":
            case "^":
              return this.compilePow(o);
            case "<?":
            case ">?":
              return this.compileMinMax(o);
            case "<<":
            case ">>":
              return this.compileCompose(o);
            case "++":
              return this.compileConcat(o);
            case "%%":
              return this.compileMod(o);
            case "xor":
              return this.compileXor(o);
            case "&&":
            case "||":
              if (top = this["void"] || !o.level) {
                this.second["void"] = true;
              }
              if (top || this.cond) {
                this.first.cond = true;
                this.second.cond = true;
              }
              break;
            case "instanceof":
              rite = this.second, items = rite.items;
              if (rite instanceof Arr) {
                if (items[1]) {
                  return this.compileAnyInstanceOf(o, items);
                }
                this.second = items[0] || rite;
              }
              this.second.isCallable() || this.second.carp("invalid instanceof operand");
              break;
            case "====":
            case "!===":
              this.op = this.op.slice(0, 3);
            // fallthrough
            case "<==":
            case ">==":
            case "<<=":
            case ">>=":
              return this.compileDeepEq(o);
            default:
              if (COMPARER.test(this.op)) {
                if (that = ((ref$2 = this.op) === "===" || ref$2 === "!==") && this.xorChildren(function(it) {
                  return it.isRegex();
                })) {
                  return this.compileRegexEquals(o, that);
                }
                if (this.op === "===" && (this.first instanceof Literal && this.second instanceof Literal) && this.first.isWhat() !== this.second.isWhat()) {
                  if (o.warn) {
                    this.warn("strict comparison of two different types will always be false: " + this.first.value + " == " + this.second.value);
                  }
                }
              }
              if (COMPARER.test(this.op) && COMPARER.test(this.second.op)) {
                return this.compileChain(o);
              }
          }
          this.first.front = this.front;
          code = [this.first.compile(o, level = LEVEL_OP + PREC[this.op]), " ", this.mapOp(this.op), " ", this.second.compile(o, level)];
          if (o.level <= level) {
            return sn.apply(null, [this].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [this, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Binary2.prototype.mapOp = function(op) {
          var that;
          switch (false) {
            case !(that = op.match(/\.([&\|\^]|<<|>>>?)\./)):
              return that[1];
            case op !== "of":
              return "in";
            default:
              return op;
          }
        };
        Binary2.prototype.compileChain = function(o) {
          var code, level, ref$2, sub;
          code = [this.first.compile(o, level = LEVEL_OP + PREC[this.op])];
          ref$2 = this.second.first.cache(o, true), sub = ref$2[0], this.second.first = ref$2[1];
          code.push(" ", this.op, " ", sub.compile(o, level), " && ", this.second.compile(o, LEVEL_OP));
          if (o.level <= LEVEL_OP) {
            return sn.apply(null, [this].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [this, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Binary2.prototype.compileExistence = function(o) {
          var x;
          if (this["void"] || !o.level) {
            x = Binary2("&&", Existence(this.first, true), this.second);
            return (x["void"] = true, x).compileNode(o);
          }
          x = this.first.cache(o, true);
          return sn(this, If(Existence(x[0]), x[1]).addElse(this.second).compileExpression(o));
        };
        Binary2.prototype.compileAnyInstanceOf = function(o, items) {
          var ref$2, sub, ref, test, i$, len$, item;
          ref$2 = this.first.cache(o), sub = ref$2[0], ref = ref$2[1], this.temps = ref$2[2];
          test = Binary2("instanceof", sub, items.shift());
          for (i$ = 0, len$ = items.length; i$ < len$; ++i$) {
            item = items[i$];
            test = Binary2("||", test, Binary2("instanceof", ref, item));
          }
          return sn(this, Parens(test).compile(o));
        };
        Binary2.prototype.compileMinMax = function(o) {
          var lefts, rites, x;
          lefts = this.first.cache(o, true);
          rites = this.second.cache(o, true);
          x = Binary2(this.op.charAt(), lefts[0], rites[0]);
          return sn(this, If(x, lefts[1]).addElse(rites[1]).compileExpression(o));
        };
        Binary2.prototype.compileMethod = function(o, klass, method, arg) {
          var args;
          args = [this.second].concat(arg || []);
          if (this.first["is" + klass]()) {
            return sn(this, Chain(this.first, [Index(Key(method)), Call(args)]).compile(o));
          } else {
            args.unshift(this.first);
            return sn(this, Call.make(JS(util(method) + ".call"), args).compile(o));
          }
        };
        Binary2.prototype.compileJoin = function(it) {
          return this.compileMethod(it, "Array", "join");
        };
        Binary2.prototype.compileRemove = function(it) {
          return this.compileMethod(it, "String", "replace", JS("''"));
        };
        Binary2.prototype.compileSplit = function(it) {
          return this.compileMethod(it, "String", "split");
        };
        Binary2.prototype.compileRepeat = function(o) {
          var x, items, n, arr, arrCode, refs, i$, len$, i, item, ref$2, q;
          x = this.first, items = x.items, n = this.second;
          arr = x.isArray() && "Array";
          if (items && !snEmpty(arrCode = Splat.compileArray(o, items))) {
            x = JS(arrCode);
            items = null;
          }
          if (arr && !items || !(n instanceof Literal && n.value < 32)) {
            return sn(this, Call.make(Util("repeat" + (arr || "String")), [x, n]).compile(o));
          }
          n = +n.value;
          if (1 <= n && n < 2) {
            return sn(this, x.compile(o));
          }
          if (items) {
            if (n < 1) {
              return sn(this, Block(items).add(JS("[]")).compile(o));
            }
            refs = [];
            for (i$ = 0, len$ = items.length; i$ < len$; ++i$) {
              i = i$;
              item = items[i$];
              ref$2 = item.cache(o, 1), items[i] = ref$2[0], refs[refs.length] = ref$2[1];
            }
            items.push((ref$2 = JS(), ref$2.compile = function() {
              return sn.apply(null, [this].concat(arrayFrom$(repeatArray$([", ", List.compile(o, refs)], n - 1).slice(1))));
            }, ref$2));
            return sn(this, x.compile(o));
          } else if (x instanceof Literal) {
            return sn(this, (q = (x = x.compile(o).toString()).charAt()) + repeatString$(x.slice(1, -1) + "", n) + q);
          } else {
            if (n < 1) {
              return sn(this, Block(x.it).add(JS("''")).compile(o));
            }
            x = (refs = x.cache(o, 1, LEVEL_OP))[0] + repeatString$(" + " + refs[1], n - 1);
            if (o.level < LEVEL_OP + PREC["+"]) {
              return sn(this, x);
            } else {
              return sn(this, "(", x, ")");
            }
          }
        };
        Binary2.prototype.compilePow = function(o) {
          return sn(null, Call.make(CopyL(this, JS("Math.pow")), [this.first, this.second]).compile(o));
        };
        Binary2.prototype.compileConcat = function(o) {
          var f;
          f = function(x) {
            switch (false) {
              case !(x instanceof Binary2 && x.op === "++"):
                return f(x.first).concat(f(x.second));
              default:
                return [x];
            }
          };
          return sn(null, Chain(this.first).add(CopyL(this, Index(Key("concat"), ".", true))).add(Call(f(this.second))).compile(o));
        };
        Binary2.prototype.compileCompose = function(o) {
          var op, functions, x;
          op = this.op;
          functions = [this.first];
          x = this.second;
          while (x instanceof Binary2 && x.op === op && !x.partial) {
            functions.push(x.first);
            x = x.second;
          }
          functions.push(x);
          if (op === "<<") {
            functions.reverse();
          }
          return sn(this, Chain(Var(util("compose"))).add(Call(functions)).compile(o));
        };
        Binary2.prototype.compileMod = function(o) {
          var ref, code;
          ref = o.scope.temporary();
          code = [sn(this, "(("), this.first.compile(o), sn(this, ") % ("), sn(this, ref, " = "), this.second.compile(o), sn(this, ") + ", ref, ") % ", ref)];
          o.scope.free(ref);
          if (o.level < LEVEL_OP + PREC["%"]) {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [null, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Binary2.prototype.compilePartial = function(o) {
          var vit, x, y;
          vit = Var("it");
          switch (false) {
            case !(this.first == null && this.second == null):
              x = Var("x$");
              y = Var("y$");
              return sn(this, Fun([x, y], Block(Binary2(this.op, x, y).invertCheck(this)), false, true).compile(o));
            case this.first == null:
              return sn(this, "(", Fun([vit], Block(Binary2(this.op, this.first, vit).invertCheck(this)), true).compile(o), ")");
            default:
              return sn(this, "(", Fun([vit], Block(Binary2(this.op, vit, this.second).invertCheck(this)), true).compile(o), ")");
          }
        };
        Binary2.prototype.compileRegexEquals = function(o, arg$) {
          var regex, target, method;
          regex = arg$[0], target = arg$[1];
          if (this.op === "===") {
            method = this.wasInverted ? "test" : "exec";
            return sn(this, Chain(regex).add(Index(Key(method))).add(Call([target])).compile(o));
          } else {
            return sn(this, Unary("!", Chain(regex).add(Index(Key("test"))).add(Call([target]))).compile(o));
          }
        };
        Binary2.prototype.compileDeepEq = function(o) {
          var ref$2, negate, i$, len$, x, r;
          if ((ref$2 = this.op) === ">==" || ref$2 === ">>=") {
            ref$2 = [this.second, this.first], this.first = ref$2[0], this.second = ref$2[1];
            this.op = this.op === ">==" ? "<==" : "<<=";
          }
          if (this.op === "!==") {
            this.op = "===";
            negate = true;
          }
          for (i$ = 0, len$ = (ref$2 = [this.first, this.second]).length; i$ < len$; ++i$) {
            x = ref$2[i$];
            if (x instanceof Obj || x instanceof Arr) {
              x.deepEq = true;
            }
          }
          r = Chain(Var(util("deepEq"))).add(Call([this.first, this.second, Literal("'" + this.op + "'")]));
          return sn(this, (negate ? Unary("!", r) : r).compile(o));
        };
        Binary2.prototype.compileXor = function(o) {
          var left, right;
          left = Chain(this.first).cacheReference(o);
          right = Chain(this.second).cacheReference(o);
          return sn(this, Binary2("&&", Binary2("!==", Unary("!", left[0]), Unary("!", right[0])), Parens(Binary2("||", left[1], right[1]))).compile(o));
        };
        return Binary2;
      })(Node);
      exports.Assign = Assign = (function(superclass) {
        var prototype = extend$((import$(Assign2, superclass).displayName = "Assign", Assign2), superclass).prototype, constructor = Assign2;
        function Assign2(left, rite, op, logic, defParam) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.left = left;
          this$.op = op || "=";
          this$.logic = logic || this$.op.logic;
          this$.defParam = defParam;
          this$.opLoc = this$.op;
          this$.op += "";
          this$[rite instanceof Node ? "right" : "unaries"] = rite;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Assign2.prototype.children = ["left", "right"];
        Assign2.prototype.show = function() {
          return [void 0].concat(this.unaries).reverse().join(" ") + [this.logic] + this.op;
        };
        Assign2.prototype.assigns = function() {
          return this.left.assigns();
        };
        Assign2.prototype.getRef = function() {
          if (!this.left.isComplex()) {
            return this.left;
          }
        };
        prototype.delegate(["isCallable", "isRegex"], function(it) {
          var ref$2;
          return ((ref$2 = this.op) === "=" || ref$2 === ":=") && this.right && this.right[it]();
        });
        Assign2.prototype.isArray = function() {
          switch (this.op) {
            case "=":
            case ":=":
              return this.right && this.right.isArray();
            case "/=":
              return this.right && this.right.isMatcher();
          }
        };
        Assign2.prototype.isString = function() {
          switch (this.op) {
            case "=":
            case ":=":
            case "+=":
            case "*=":
              return this.right && this.right.isString();
            case "-=":
              return this.right && this.right.isMatcher();
          }
        };
        Assign2.prototype.unfoldSoak = function(o) {
          var that, ref$2, ref1$, rite, temps;
          if (this.left instanceof Existence) {
            if (that = (ref1$ = (ref$2 = this.left = this.left.it).name, delete ref$2.name, ref1$)) {
              rite = this.right;
              rite = Assign2(this.right = Var(that), rite);
            } else {
              ref$2 = this.right.cache(o), rite = ref$2[0], this.right = ref$2[1], temps = ref$2[2];
            }
            return ref$2 = If(Existence(rite), this), ref$2.temps = temps, ref$2.cond = this.cond, ref$2["void"] = this["void"], ref$2;
          }
          return If.unfoldSoak(o, this, "left");
        };
        Assign2.prototype.unfoldAssign = function() {
          return this.access && this;
        };
        Assign2.prototype.compileNode = function(o) {
          var left, sp, ref$2, i$, len$, op, right, reft, sign, name, lvar, that, protoSplit, dotSplit, code, empty, res;
          if (this.left instanceof Slice && this.op === "=") {
            return this.compileSplice(o);
          }
          left = this.left;
          if (sp = this.left instanceof Splat) {
            left = left.it;
          }
          if (sp) {
            left instanceof List || this.left.carp("invalid splat");
            return this.compileSpread(o, left);
          }
          if (!this.right) {
            left.isAssignable() || left.carp("invalid unary assign");
            ref$2 = Chain(left).cacheReference(o), left = ref$2[0], this.right = ref$2[1];
            for (i$ = 0, len$ = (ref$2 = this.unaries).length; i$ < len$; ++i$) {
              op = ref$2[i$];
              this.right = Unary(op, this.right);
            }
          }
          if (left.isEmpty()) {
            return sn(null, (ref$2 = Parens(this.right), ref$2.front = this.front, ref$2.newed = this.newed, ref$2).compile(o));
          }
          if (left.getDefault()) {
            this.right = Binary(left.op, this.right, left.second);
            left = left.first;
          }
          if (left.items) {
            return this.compileDestructuring(o, left);
          }
          left.isAssignable() || left.carp("invalid assign");
          if (this.logic) {
            return this.compileConditional(o, left);
          }
          op = this.op, right = this.right;
          if (op === "<?=" || op === ">?=") {
            return this.compileMinMax(o, left, right);
          }
          if (op === "**=" || op === "^=" || op === "%%=" || op === "++=" || op === "|>=" || op === "*=" && right.isString() || (op === "-=" || op === "/=") && right.isMatcher()) {
            ref$2 = Chain(left).cacheReference(o), left = ref$2[0], reft = ref$2[1];
            right = Binary(op.slice(0, -1), reft, right);
            op = ":=";
          }
          if (op === ".&.=" || op === ".|.=" || op === ".^.=" || op === ".<<.=" || op === ".>>.=" || op === ".>>>.=") {
            op = op.slice(1, -2) + "=";
          }
          (right = right.unparen()).ripName(left = left.unwrap());
          if (left instanceof Chain) {
            left.expandVivify();
            if ((left = left.unwrap()) instanceof Assign2) {
              ref$2 = Chain(left.left).cacheReference(o), left.left = ref$2[0], this.left = ref$2[1];
              return Block([left, (ref$2 = clone$(this), ref$2.terminator = "", ref$2)]).compile(o);
            }
          }
          sign = sn(this.opLoc, " ", op.replace(":", ""), " ");
          name = (left.front = true, left).compile(o, LEVEL_LIST);
          if (lvar = left instanceof Var) {
            if (op === "=") {
              o.scope.declare(name.toString(), left, this["const"] || !this.defParam && o["const"] && "$" !== name.toString().slice(-1));
            } else if (that = o.scope.checkReadOnly(name.toString())) {
              left.carp("assignment to " + that + ' "' + name + '"', ReferenceError);
            }
          }
          if (left instanceof Chain && right instanceof Fun) {
            protoSplit = name.toString().split(".prototype.");
            dotSplit = name.toString().split(".");
            if (protoSplit.length > 1) {
              right.inClass = protoSplit[0];
            } else if (dotSplit.length > 1) {
              right.inClassStatic = slice$.call(dotSplit, 0, -1).join("");
            }
          }
          code = !o.level && right instanceof While && !right["else"] && (lvar || left instanceof Chain && left.isSimpleAccess()) ? (empty = right.objComp ? "{}" : "[]", [res = o.scope.temporary("res"), " = " + empty + ";\n" + this.tab, right.makeReturn(res).compile(o), "\n" + this.tab, name, sign, o.scope.free(res)]) : [name, sign, right.compile(o, LEVEL_LIST)];
          if (o.level > LEVEL_LIST) {
            code = ["("].concat(arrayFrom$(code), [")"]);
          }
          return sn.apply(null, [null].concat(arrayFrom$(code)));
        };
        Assign2.prototype.compileConditional = function(o, left) {
          var ref$2, lcache, morph;
          if (left instanceof Var && this.logic === "?" && this.op === "=") {
            o.scope.declare(left.value, left);
          }
          ref$2 = Chain(left).cacheReference(o), lcache = ref$2[0], left = ref$2[1];
          o.level += LEVEL_OP < o.level;
          if (this.logic === "?" && ((ref$2 = this.op) !== "=" && ref$2 !== ":=")) {
            this.logic = "&&";
            lcache = Existence(lcache);
          }
          morph = Binary(this.logic, lcache, (this.logic = false, this.left = left, this));
          return sn(this, (morph["void"] = this["void"], morph).compileNode(o));
        };
        Assign2.prototype.compileMinMax = function(o, left, right) {
          var lefts, rites, test, put, ref$2;
          lefts = Chain(left).cacheReference(o);
          rites = right.cache(o, true);
          test = Binary(this.op.replace("?", ""), lefts[0], rites[0]);
          put = Assign2(lefts[1], rites[1], ":=");
          if (this["void"] || !o.level) {
            return Parens(Binary("||", test, put)).compile(o);
          }
          ref$2 = test.first.cache(o, true), test.first = ref$2[0], left = ref$2[1];
          return sn(this, If(test, left).addElse(put).compileExpression(o));
        };
        Assign2.prototype.compileDestructuring = function(o, left) {
          var items, len, ret, rite, that, cache, rref, destructureArgs, list, code, sep, i$, len$, item;
          items = left.items, len = items.length;
          ret = o.level && !this["void"];
          rite = this.right.compile(o, len === 1 ? LEVEL_CALL : LEVEL_LIST);
          if (that = left.name) {
            cache = sn(this, that, " = ", rite);
            o.scope.declare(rite = that, left);
          } else if ((ret || len > 1) && (!ID.test(rite.toString()) || (that = left.assigns()) && in$(rite.toString(), that))) {
            cache = sn(this, rref = o.scope.temporary(), " = ", rite);
            rite = rref;
          }
          if (rite.toString() === "arguments" && !ret) {
            destructureArgs = true;
            if (!(left instanceof Arr)) {
              this.carp("arguments can only destructure to array");
            }
          }
          list = this["rend" + left.constructor.displayName](o, items, rite, destructureArgs);
          if (rref) {
            o.scope.free(rref);
          }
          if (cache) {
            list.unshift(cache);
          }
          if (ret || !list.length) {
            list.push(rite);
          }
          code = [];
          sep = destructureArgs ? "; " : ", ";
          for (i$ = 0, len$ = list.length; i$ < len$; ++i$) {
            item = list[i$];
            code.push(item, sep);
          }
          code.pop();
          if (list.length < 2 || o.level < LEVEL_LIST) {
            return sn.apply(null, [this].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [this, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Assign2.prototype.compileSplice = function(o) {
          var ref$2, fromExpNode, fromExp, rightNode, right, toExp;
          ref$2 = Chain(this.left.from).cacheReference(o), fromExpNode = ref$2[0], fromExp = ref$2[1];
          ref$2 = Chain(this.right).cacheReference(o), rightNode = ref$2[0], right = ref$2[1];
          toExp = Binary("-", this.left.to, fromExp);
          return sn(this, Block([Chain(Var(util("splice"))).add(Index(Key("apply"), ".", true)).add(Call([this.left.target, Chain(Arr([fromExpNode, toExp])).add(Index(Key("concat"), ".", true)).add(Call([rightNode]))])), right]).compile(o, LEVEL_LIST));
        };
        Assign2.prototype.compileSpread = function(o, left) {
          var that, ref$2, rite, rref, this$ = this;
          ref$2 = (that = this.unaries) ? [that, that] : left.items.length <= 1 ? [ref$2 = this.right, ref$2] : this.right.cache(o, true), rite = ref$2[0], rref = ref$2[1];
          return this.compileSpreadOver(o, left, function(it) {
            var result;
            result = constructor(it, rite, this$.op, this$.logic);
            rite = rref;
            return result;
          });
        };
        Assign2.prototype.rendArr = function(o, nodes, rite, destructureArgs) {
          var ret, i$, len$, i, node, skip, len, val, ivar, start, inc, rcache, tmp, vtmp, ref$2;
          function argsSlice(begin, end) {
            return new For({
              ref: true,
              from: begin,
              op: "til",
              to: end
            }).makeComprehension(Chain(Var("arguments")).add(Index(Literal(".."))), []);
          }
          ret = [];
          for (i$ = 0, len$ = nodes.length; i$ < len$; ++i$) {
            i = i$;
            node = nodes[i$];
            if (node.isEmpty()) {
              continue;
            }
            if (node instanceof Splat) {
              len && node.carp("multiple splat in an assignment");
              skip = (node = node.it).isEmpty();
              if (i + 1 === (len = nodes.length)) {
                if (skip) {
                  break;
                }
                if (destructureArgs) {
                  val = argsSlice(Literal(i), Chain(Var("arguments")).add(Index(Key("length"))));
                } else {
                  val = Arr.wrap(JS(util("slice") + ".call(" + rite + (i ? ", " + i + ")" : ")")));
                }
              } else {
                val = ivar = rite + ".length - " + (len - i - 1);
                if (skip && i + 2 === len) {
                  continue;
                }
                start = i + 1;
                (this.temps || (this.temps = [])).push(ivar = o.scope.temporary("i"));
                val = fn$();
              }
            } else {
              (inc = ivar) && start < i && (inc += " + " + (i - start));
              val = Chain(rcache || (rcache = Literal(rite)), [Index(JS(inc || i))]);
            }
            if (destructureArgs) {
              if (!(node instanceof Var) && val instanceof For) {
                (this.temps || (this.temps = [])).push(tmp = o.scope.temporary("ref"));
                vtmp = Var(tmp);
                ret.push((ref$2 = clone$(this), ref$2.left = vtmp, ref$2.right = val, ref$2["void"] = true, ref$2).compile(o, LEVEL_TOP));
                ret.push((ref$2 = clone$(this), ref$2.left = node, ref$2.right = vtmp, ref$2["void"] = true, ref$2).compile(o, LEVEL_TOP));
              } else {
                ret.push((ref$2 = clone$(this), ref$2.left = node, ref$2.right = val, ref$2["void"] = true, ref$2).compile(o, LEVEL_TOP));
              }
            } else {
              ret.push((ref$2 = clone$(this), ref$2.left = node, ref$2.right = val, ref$2["void"] = true, ref$2).compile(o, LEVEL_PAREN));
            }
          }
          return ret;
          function fn$() {
            switch (false) {
              case !skip:
                return Arr.wrap(JS(i + " < (" + ivar + " = " + val + ") ? " + i + " : (" + ivar + " = " + i + ")"));
              case !destructureArgs:
                return argsSlice(JS(i + " < (" + ivar + " = " + val + ") ? " + i + " : (" + ivar + " = " + i + ")"), Var(ivar));
              default:
                return Arr.wrap(JS(i + " < (" + ivar + " = " + val + ") ? " + util("slice") + ".call(" + rite + ", " + i + ", " + ivar + ") : (" + ivar + " = " + i + ", [])"));
            }
          }
        };
        Assign2.prototype.rendObj = function(o, nodes, rite) {
          var keys, pairs, rvar, i$, len$, ref$2, key, lval, logic, excludes, val, left, right, results$ = [];
          keys = [];
          pairs = [];
          rvar = Var(rite);
          for (i$ = 0, len$ = nodes.length; i$ < len$; ++i$) {
            ref$2 = nodes[i$], key = ref$2.key, lval = ref$2.val, logic = ref$2.logic;
            lval = lval.unparen();
            if (key instanceof Splat) {
              logic != null && this.carp("invalid assign");
              excludes = Obj(fn$.call(this));
              val = Chain(Var(util("copyWithout"))).add(Call([rvar, excludes]));
            } else {
              keys.push(key);
              if (logic) {
                lval = (logic.first = lval, logic);
              }
              val = Chain(rvar, [Index(key)]);
            }
            pairs.push([lval, val]);
          }
          for (i$ = 0, len$ = pairs.length; i$ < len$; ++i$) {
            ref$2 = pairs[i$], left = ref$2[0], right = ref$2[1];
            results$.push((ref$2 = clone$(this), ref$2.left = left, ref$2.right = right, ref$2["void"] = true, ref$2.temps = [], ref$2).compile(o, LEVEL_PAREN));
          }
          return results$;
          function fn$() {
            var i$2, x$, ref$3, len$2, results$2 = [];
            for (i$2 = 0, len$2 = (ref$3 = keys).length; i$2 < len$2; ++i$2) {
              x$ = ref$3[i$2];
              results$2.push(Prop(x$.extractKeyRef(o, true, this), Literal(0)));
            }
            return results$2;
          }
        };
        Assign2.prototype.rewriteShorthand = function(o, assign) {
          var bin, ref$2, that, ref1$;
          if (assign) {
            if (this === (bin = this.maybeLogic())) {
              this.carp("invalid assign");
            }
            return (ref$2 = bin.rewriteShorthand(o, true)) != null ? ref$2 : bin;
          }
          if (that = (ref$2 = this.left) != null ? ref$2.rewriteShorthand(o, true) : void 0) {
            this.left = that;
          }
          if (that = (ref1$ = this.right) != null ? ref1$.rewriteShorthand(o) : void 0) {
            this.right = that;
          }
        };
        Assign2.prototype.maybeLogic = function() {
          if (this.op === "=") {
            return Binary(this.logic || "?", this.left, this.right);
          } else {
            return this;
          }
        };
        return Assign2;
      })(Node);
      exports.Import = Import = (function(superclass) {
        var prototype = extend$((import$(Import2, superclass).displayName = "Import", Import2), superclass).prototype, constructor = Import2;
        function Import2(left, right, all) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.left = left;
          this$.right = right;
          this$.all = all && "All";
          if (!all && left instanceof Obj && right.items) {
            return Obj(left.items.concat(right.asObj().items));
          }
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Import2.prototype.children = ["left", "right"];
        Import2.prototype.show = function() {
          return this.all;
        };
        prototype.delegate(["isCallable", "isArray"], function(it) {
          return this.left[it]();
        });
        Import2.prototype.unfoldSoak = function(o) {
          var left, value, ref$2, temps;
          left = this.left;
          if (left instanceof Existence && !left.negated) {
            if ((left = left.it) instanceof Var) {
              value = (this.left = left).value;
              if (!o.scope.check(value, true)) {
                left = JS("typeof " + value + " != 'undefined' && " + value);
              }
            } else {
              ref$2 = left.cache(o), left = ref$2[0], this.left = ref$2[1], temps = ref$2[2];
            }
            return ref$2 = If(left, this), ref$2.temps = temps, ref$2.soak = true, ref$2.cond = this.cond, ref$2["void"] = this["void"], ref$2;
          }
          return If.unfoldSoak(o, this, "left") || (this["void"] || !o.level) && If.unfoldSoak(o, this, "right");
        };
        Import2.prototype.compileNode = function(o) {
          var right;
          right = this.right;
          if (!this.all) {
            if (right instanceof Chain) {
              right = right.unfoldSoak(o) || right.unfoldAssign(o) || right;
            }
            if (right instanceof List) {
              return this.compileAssign(o, right.asObj().items);
            }
          }
          return CopyL(this, Call.make(Util("import" + (this.all || "")), [this.left, right])).compileNode(o);
        };
        Import2.prototype.compileAssign = function(o, items) {
          var top, reft, ref$2, left, delim, space, code, i$, len$, i, node, com, key, val, logic;
          if (!items.length) {
            return this.left.compile(o);
          }
          top = !o.level;
          if (this.proto || items.length < 2 && (top || this["void"] || items[0].key instanceof Splat)) {
            reft = this.left;
            if (reft.isComplex()) {
              reft = Parens(reft);
            }
          } else {
            ref$2 = this.left.cache(o), left = ref$2[0], reft = ref$2[1], this.temps = ref$2[2];
          }
          ref$2 = top ? [";", "\n" + this.tab] : [",", " "], delim = ref$2[0], space = ref$2[1];
          delim += space;
          code = this.temps ? [left.compile(o, LEVEL_PAREN), delim] : [];
          for (i$ = 0, len$ = items.length; i$ < len$; ++i$) {
            i = i$;
            node = items[i$];
            i && code.push(com ? space : delim);
            if (com = node.comment) {
              code.push(node.compile(o));
              continue;
            }
            key = node.key, val = node.val, logic = node.logic;
            if (key instanceof Splat) {
              code.push(CopyL(this, Import2(reft, val)).compile(o));
              continue;
            }
            if (node.accessor) {
              if (key instanceof Key) {
                key = JS("'" + key.name + "'");
              }
              code.push("Object.defineProperty(", reft.compile(o, LEVEL_LIST), ", ", key.compile(o, LEVEL_LIST), ", ", node.compileDescriptor(o), ")");
              continue;
            }
            logic && (val = (logic.first = val, logic));
            code.push(Assign(Chain(reft, [Index(key)]), val).compile(o, LEVEL_PAREN));
          }
          if (top) {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          }
          this["void"] || key instanceof Splat || code.push(com ? " " : ", ", reft.compile(o, LEVEL_PAREN));
          if (o.level < LEVEL_LIST) {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [null, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        Import2.prototype.rewriteShorthand = function(o, assign) {
          var that, ref$2, ref1$;
          if (that = (ref$2 = this.left) != null ? ref$2.rewriteShorthand(o, assign) : void 0) {
            this.left = that;
          }
          if (that = (ref1$ = this.right) != null ? ref1$.rewriteShorthand(o) : void 0) {
            this.right = that;
          }
        };
        return Import2;
      })(Node);
      exports.In = In = (function(superclass) {
        var prototype = extend$((import$(In2, superclass).displayName = "In", In2), superclass).prototype, constructor = In2;
        importAll$(prototype, arguments[1]);
        function In2(item, array) {
          this.item = item;
          this.array = array;
        }
        In2.prototype.children = ["item", "array"];
        In2.prototype.compileNode = function(o) {
          var array, items, value, code, ref$2, sub, ref, cmp, cnj, i$, len$, i, test;
          items = (array = this.array).items;
          if (!(array instanceof Arr)) {
            return sn(this, this.negated ? "!" : "", util("in"), "(", this.item.compile(o, LEVEL_LIST), ", ", array.compile(o, LEVEL_LIST), ")");
          }
          if (items.length === 0) {
            if (o.warn) {
              this.warn("value can never be `in` an empty array");
            }
            value = !!this.negated + "";
            return this.item.isComplex() ? sn(this, "(", this.item.compile(o, LEVEL_LIST), ", ", value, ")") : sn(this, value);
          }
          code = [];
          ref$2 = items.length === 1 ? [ref$2 = this.item.compile(o, LEVEL_PAREN), ref$2] : this.item.cache(o, false, LEVEL_PAREN), sub = ref$2[0], ref = ref$2[1];
          ref$2 = this.negated ? [" !== ", " && "] : [" === ", " || "], cmp = ref$2[0], cnj = ref$2[1];
          for (i$ = 0, len$ = items.length; i$ < len$; ++i$) {
            i = i$;
            test = items[i$];
            if (code.length > 0) {
              code.push(cnj);
            }
            if (test instanceof Splat) {
              code.push((ref$2 = new In2(Var(ref), test.it), ref$2.negated = this.negated, ref$2).compile(o, LEVEL_TOP));
              if (!(i || sub === ref)) {
                code = ["(" + sub + ", "].concat(arrayFrom$(code), [")"]);
              }
            } else {
              code.push(i || sub === ref ? ref : "(" + sub + ")", cmp, test.compile(o, LEVEL_OP + PREC["=="]));
            }
          }
          sub === ref || o.scope.free(ref);
          if (o.level < LEVEL_OP + PREC[items.length === 1 ? "===" : "||"]) {
            return sn.apply(null, [this].concat(arrayFrom$(code)));
          } else {
            return sn.apply(null, [this, "("].concat(arrayFrom$(code), [")"]));
          }
        };
        return In2;
      })(Node, Negatable);
      exports.Existence = Existence = (function(superclass) {
        var prototype = extend$((import$(Existence2, superclass).displayName = "Existence", Existence2), superclass).prototype, constructor = Existence2;
        importAll$(prototype, arguments[1]);
        function Existence2(it, negated) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.it = it;
          this$.negated = negated;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Existence2.prototype.children = ["it"];
        Existence2.prototype.compileNode = function(o) {
          var node, ref$2, code, op, eq, anaphPre, anaphPost, that;
          node = (ref$2 = this.it.unwrap(), ref$2.front = this.front, ref$2);
          code = [node.compile(o, LEVEL_OP + PREC["=="])];
          if (this.doAnaphorize) {
            o.scope.declare("that", Var("that"));
          }
          if (node instanceof Var && !o.scope.check(code.join(""), true)) {
            ref$2 = this.negated ? ["||", "="] : ["&&", "!"], op = ref$2[0], eq = ref$2[1];
            if (this.doAnaphorize) {
              ref$2 = this.negated ? [["(that = undefined) || "], []] : [[], [" && (that = "].concat(arrayFrom$(code), [", true)"])], anaphPre = ref$2[0], anaphPost = ref$2[1];
            }
            code = ["typeof "].concat(arrayFrom$(code), [" " + eq + "= 'undefined' " + op + " "], arrayFrom$(code), [" " + eq + "== null"]);
            if ((that = anaphPre) != null) {
              code = that.concat(code);
            }
            if ((that = anaphPost) != null) {
              code = code.concat(that);
            }
          } else {
            if (this.doAnaphorize) {
              code = ["(that = "].concat(arrayFrom$(code), [")"]);
            }
            code.push(" " + (op = this.negated ? "==" : "!=") + " null");
          }
          if (o.level < LEVEL_OP + PREC[op]) {
            return sn.apply(null, [this].concat(arrayFrom$(code)));
          } else {
            return sn(this, "(", code, ")");
          }
        };
        return Existence2;
      })(Node, Negatable);
      exports.Fun = Fun = (function(superclass) {
        var prototype = extend$((import$(Fun2, superclass).displayName = "Fun", Fun2), superclass).prototype, constructor = Fun2;
        function Fun2(params, body, bound, curried, hushed, generator, async) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.params = params || [];
          this$.body = body || Block();
          this$.bound = bound && "this$";
          this$.curried = curried || false;
          this$.hushed = hushed != null ? hushed : false;
          this$.generator = generator != null ? generator : false;
          this$.async = async != null ? async : false;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Fun2.prototype.children = ["params", "body"];
        Fun2.prototype.show = function() {
          var that;
          return [this.name] + [(that = this.bound) ? "~" + that : void 0];
        };
        Fun2.prototype.named = function(it) {
          return this.name = it, this.statement = true, this;
        };
        Fun2.prototype.isCallable = YES;
        Fun2.prototype.isStatement = function() {
          return !!this.statement;
        };
        Fun2.prototype.traverseChildren = function(arg$, xscope) {
          if (xscope) {
            return superclass.prototype.traverseChildren.apply(this, arguments);
          }
        };
        Fun2.prototype.rewriteShorthand = VOID;
        Fun2.prototype.makeReturn = function() {
          if (this.statement) {
            return this.returns = true, this;
          } else {
            return superclass.prototype.makeReturn.apply(this, arguments);
          }
        };
        Fun2.prototype.ripName = function(it) {
          this.name || (this.name = it.varName());
        };
        Fun2.prototype.compileNode = function(o) {
          var pscope, sscope, scope, that, inLoop, ref$2, body, name, tab, code, bodyCode, curryCodeCheck, this$ = this;
          pscope = o.scope;
          sscope = pscope.shared || pscope;
          scope = o.scope = this.body.scope = new Scope(this.wrapper ? pscope : sscope, this.wrapper && sscope);
          scope.fun = this;
          if (that = this.proto) {
            scope.assign("prototype", that.compile(o) + ".prototype");
          }
          if (that = this.cname) {
            scope.assign("constructor", that);
          }
          if (inLoop = (ref$2 = o.loop, delete o.loop, ref$2)) {
            o.indent = this.tab = "";
          }
          o.indent += TAB;
          body = this.body, name = this.name, tab = this.tab;
          code = ["function"];
          if (this.async) {
            this.ctor && this.carp("a constructor can't be async");
            o.inAsync = true;
            code.unshift("async ");
          } else if (!this.wrapper) {
            o.inAsync = false;
          }
          if (this.generator) {
            this.ctor && this.carp("a constructor can't be a generator");
            o.inGenerator = true;
            code.push("*");
          } else if (!this.wrapper) {
            o.inGenerator = false;
          }
          if (this.bound === "this$") {
            if (this.ctor) {
              scope.assign("this$", "this instanceof ctor$ ? this : new ctor$");
              body.lines.push(Return(Literal("this$")));
            } else if (that = (ref$2 = sscope.fun) != null ? ref$2.bound : void 0) {
              this.bound = that;
            } else if (this.usesThis()) {
              sscope.assign("this$", "this");
            }
          }
          if (this.statement) {
            name || this.carp("nameless function declaration");
            pscope === o.block.scope || this.carp("misplaced function declaration");
            this.accessor && this.carp("named accessor");
            pscope.add(name, "function", this);
          }
          if (this.statement || name && this.labeled) {
            code.push(" ", scope.add(name, "function", this));
          }
          this.hushed || this.ctor || this.newed || body.makeReturn();
          code.push("(", this.compileParams(o, scope), ")");
          code = [sn.apply(null, [this].concat(arrayFrom$(code)))];
          code.push("{");
          if (!snEmpty(bodyCode = body.compileWithDeclarations(o))) {
            code.push("\n", bodyCode, "\n" + tab);
          }
          code.push("}");
          curryCodeCheck = function() {
            if (this$.curried && this$.hasSplats) {
              this$.carp("cannot curry a function with a variable number of arguments");
            }
            if (this$.curried && this$.params.length > 1 && !this$.classBound) {
              if (this$.bound) {
                return [util("curry"), "(("].concat(arrayFrom$(code), ["), true)"]);
              } else {
                return [util("curry"), "("].concat(arrayFrom$(code), [")"]);
              }
            } else {
              return code;
            }
          };
          if (inLoop) {
            return pscope.assign(pscope.temporary("fn"), sn.apply(null, [null].concat(arrayFrom$(curryCodeCheck()))));
          }
          if (this.returns) {
            code.push("\n" + tab + "return ", name, ";");
          } else if (this.bound && this.ctor) {
            code.push(" function ctor$(){} ctor$.prototype = prototype;");
          }
          code = curryCodeCheck();
          if (this.front && !this.statement) {
            return sn.apply(null, [null, "("].concat(arrayFrom$(code), [")"]));
          } else {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          }
        };
        Fun2.prototype.compileParams = function(o, scope) {
          var params, length, body, i$, p, len$, i, splace, rest, that, names, assigns, vr, df, unaries, hasUnary, v, ref$2, ref1$;
          params = this.params, length = params.length, body = this.body;
          for (i$ = params.length - 1; i$ >= 0; --i$) {
            p = params[i$];
            if (!(p.isEmpty() || p.filler)) {
              break;
            }
            --params.length;
          }
          for (i$ = 0, len$ = params.length; i$ < len$; ++i$) {
            i = i$;
            p = params[i$];
            if (p.left instanceof Splat) {
              p.carp("invalid splat");
            }
            if (p instanceof Splat) {
              this.hasSplats = true;
              splace = i;
            } else if (p.op === "=") {
              params[i] = Binary(p.logic || "?", p.left, p.right);
            }
          }
          if (splace != null) {
            rest = params.splice(splace, 9e9);
          } else if (this.accessor) {
            if (that = params[1]) {
              that.carp("excess accessor parameter");
            }
          } else if (!(length || this.wrapper)) {
            if (body.traverseChildren(function(it) {
              return it.value === "it" || null;
            })) {
              params[0] = Var("it");
            }
          }
          names = [];
          assigns = [];
          for (i$ = 0, len$ = params.length; i$ < len$; ++i$) {
            p = params[i$];
            vr = p;
            if (df = vr.getDefault()) {
              vr = vr.first;
            }
            if (vr.isEmpty()) {
              vr = Var(scope.temporary("arg"));
            } else if (vr.value === "..") {
              vr = Var(o.ref = scope.temporary());
            } else if (!(vr instanceof Var)) {
              unaries = [];
              while (vr instanceof Unary) {
                hasUnary = true;
                unaries.push(vr);
                vr = vr.it;
              }
              v = Var((ref1$ = (ref$2 = vr.it || vr).name, delete ref$2.name, ref1$) || vr.varName() || scope.temporary("arg"));
              assigns.push(Assign(vr, fn$()));
              vr = v;
            } else if (df) {
              assigns.push(Assign(vr, p.second, "=", p.op, true));
            }
            names.push(scope.add(vr.value, "arg", p), ", ");
          }
          if (rest) {
            while (splace--) {
              rest.unshift(Arr());
            }
            assigns.push(Assign(Arr(rest), Literal("arguments")));
          }
          if (assigns.length) {
            (ref$2 = this.body).prepend.apply(ref$2, assigns);
          }
          names.pop();
          return sn.apply(null, [null].concat(arrayFrom$(names)));
          function fn$() {
            switch (false) {
              case !df:
                return Binary(p.op, v, p.second);
              case !hasUnary:
                return fold(function(x, y) {
                  y.it = x;
                  return y;
                }, v, unaries.reverse());
              default:
                return v;
            }
          }
        };
        Fun2.prototype.usesThis = function() {
          return Node.prototype.traverseChildren.call(this, function(it) {
            switch (false) {
              case !(it instanceof Literal && it.value === "this"):
                return true;
              case !(it instanceof Fun2 && it.bound && it.usesThis()):
                return true;
            }
          });
        };
        return Fun2;
      })(Node);
      exports.Class = Class = (function(superclass) {
        var prototype = extend$((import$(Class2, superclass).displayName = "Class", Class2), superclass).prototype, constructor = Class2;
        function Class2(arg$) {
          var body;
          this.title = arg$.title, this.sup = arg$.sup, this.mixins = arg$.mixins, body = arg$.body;
          this.fun = Fun([], body);
        }
        Class2.prototype.children = ["title", "sup", "mixins", "fun"];
        Class2.prototype.isCallable = YES;
        Class2.prototype.ripName = function(it) {
          this.name = it.varName();
        };
        Class2.prototype.getRef = function() {
          var that, ref$2;
          if (that = ((ref$2 = this.title) != null ? ref$2.varName() : void 0) || this.name) {
            return Var(that);
          }
        };
        Class2.prototype.compile = function(o, level) {
          var fun, body, lines, title, boundFuncs, curriedBoundFuncs, decl, name, proto, vname, ctorName, ctor, ctorPlace, importProtoObj, i$, len$, i, node, f, args, that, imports, ref$2, res$, clas;
          fun = this.fun, body = fun.body, lines = body.lines, title = this.title;
          CopyL(this, fun);
          boundFuncs = [];
          curriedBoundFuncs = [];
          decl = title != null ? title.varName() : void 0;
          name = decl || this.name;
          if (ID.test(name || "")) {
            fun.cname = name;
          } else {
            name = "constructor";
          }
          proto = Var("prototype");
          vname = fun.proto = Var(fun.bound = name);
          ctorName = "constructor$$";
          importProtoObj = function(node2, i2) {
            var j, prop, key, i$2, ref$3, len$2, v;
            j = 0;
            for (; j < node2.items.length; j++) {
              prop = node2.items[j];
              key = prop.key;
              if (key instanceof Key && key.name === ctorName || key instanceof Literal && key.value === "'" + ctorName + "'") {
                if (ctor) {
                  node2.carp("redundant constructor");
                }
                ctor = prop.val;
                node2.items.splice(j--, 1);
                ctorPlace = i2;
              }
              if (!(prop.val instanceof Fun || prop.accessor)) {
                continue;
              }
              if (key.isComplex()) {
                key = Var(o.scope.temporary("key"));
                prop.key = Assign(key, prop.key);
              }
              if (prop.val.bound) {
                if (prop.val.curried) {
                  curriedBoundFuncs.push(prop.key);
                } else {
                  boundFuncs.push(prop.key);
                }
                prop.val.bound = false;
                prop.val.classBound = true;
              }
              for (i$2 = 0, len$2 = (ref$3 = [].concat(prop.val)).length; i$2 < len$2; ++i$2) {
                v = ref$3[i$2];
                v.meth = key;
              }
            }
            if (node2.items.length) {
              return ref$3 = Import(Chain(vname).add(Index(Key("prototype"))), node2), ref$3.proto = true, ref$3;
            } else {
              return Literal("void");
            }
          };
          for (i$ = 0, len$ = lines.length; i$ < len$; ++i$) {
            i = i$;
            node = lines[i$];
            if (node instanceof Obj) {
              lines[i] = importProtoObj(node, i);
            } else if (node instanceof Fun && !node.statement) {
              ctor && node.carp("redundant constructor");
              ctor = node;
            } else if (node instanceof Assign && node.left instanceof Chain && node.left.head.value === "this" && node.right instanceof Fun) {
              node.right.stat = node.left.tails[0].key;
            } else {
              node.traverseChildren(fn$);
            }
          }
          ctor || (ctor = lines[lines.length] = this.sup ? Fun([], Block(Chain(new Super()).add(Call([Splat(Literal("arguments"))])))) : Fun());
          if (!(ctor instanceof Fun)) {
            lines.splice(ctorPlace + 1, 0, Assign(Var(ctorName), ctor));
            lines.unshift(ctor = Fun([], Block(Return(Chain(Var(ctorName)).add(Call([Splat("arguments", true)]))))));
          }
          ctor.name = name;
          ctor.ctor = true;
          ctor.statement = true;
          for (i$ = 0, len$ = boundFuncs.length; i$ < len$; ++i$) {
            f = boundFuncs[i$];
            ctor.body.lines.unshift(Assign(Chain(Literal("this")).add(Index(f)), Chain(Var(util("bind"))).add(Call([Literal("this"), Literal("'" + f.name + "'"), Var("prototype")]))));
          }
          for (i$ = 0, len$ = curriedBoundFuncs.length; i$ < len$; ++i$) {
            f = curriedBoundFuncs[i$];
            ctor.body.lines.unshift(Assign(Chain(Literal("this")).add(Index(Key("_" + f.name))), Chain(Var(util("curry"))).add(Call([Chain(Var("prototype")).add(Index(f)), Var("true")]))), Assign(Chain(Literal("this")).add(Index(f)), Chain(Var(util("bind"))).add(Call([Literal("this"), Literal("'_" + f.name + "'")]))));
          }
          lines.push(vname);
          args = [];
          if (that = this.sup) {
            args.push(that);
            imports = Chain(Import(Literal("this"), Var("superclass")));
            fun.proto = Util.Extends(fun.cname ? Block([Assign(imports.add(Index(Key("displayName"))), Literal("'" + name + "'")), Literal(name)]) : imports, (ref$2 = fun.params)[ref$2.length] = Var("superclass"));
          }
          if (that = this.mixins) {
            res$ = [];
            for (i$ = 0, len$ = that.length; i$ < len$; ++i$) {
              args[args.length] = that[i$];
              res$.push(Import(proto, JS("arguments[" + (args.length - 1) + "]"), true));
            }
            imports = res$;
            body.prepend.apply(body, imports);
          }
          if (fun.cname && !this.sup) {
            body.prepend(Literal(name + ".displayName = '" + name + "'"));
          }
          clas = Parens(Call.make(fun, args), true);
          if (decl && title.isComplex()) {
            clas = Assign(vname, clas);
          }
          if (title) {
            clas = Assign(title, clas);
          }
          return sn(null, clas.compile(o, level));
          function fn$(it) {
            var i$2, ref$3, len$2, k, child;
            if (it instanceof Block) {
              for (i$2 = 0, len$2 = (ref$3 = it.lines).length; i$2 < len$2; ++i$2) {
                k = i$2;
                child = ref$3[i$2];
                if (child instanceof Obj) {
                  it.lines[k] = importProtoObj(child, i);
                }
              }
            }
          }
        };
        return Class2;
      })(Node);
      exports.Super = Super = (function(superclass) {
        var prototype = extend$((import$(Super2, superclass).displayName = "Super", Super2), superclass).prototype, constructor = Super2;
        function Super2() {
        }
        Super2.prototype.isCallable = YES;
        Super2.prototype.compile = function(o) {
          var scope, that, result, ref$2;
          scope = o.scope;
          if (!this.sproto) {
            for (; that = !scope.get("superclass") && scope.fun; scope = scope.parent) {
              result = that;
              if (that = result.meth) {
                return sn(this, "superclass.prototype", Index(that).compile(o));
              }
              if (that = result.stat) {
                return sn(this, "superclass", Index(that).compile(o));
              }
              if (that = scope.fun.inClass) {
                return sn(this, that, ".superclass.prototype.", scope.fun.name);
              } else if (that = scope.fun.inClassStatic) {
                return sn(this, that, ".superclass.", scope.fun.name);
              }
            }
            if (that = (ref$2 = o.scope.fun) != null ? ref$2.name : void 0) {
              return sn(this, that, ".superclass");
            }
          }
          return sn(this, "superclass");
        };
        Super2.prototype.maybeKey = function() {
          return Key("super", true);
        };
        return Super2;
      })(Node);
      exports.Parens = Parens = (function(superclass) {
        var prototype = extend$((import$(Parens2, superclass).displayName = "Parens", Parens2), superclass).prototype, constructor = Parens2;
        function Parens2(it, keep, string, lb, rb) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.it = it;
          this$.keep = keep;
          this$.string = string;
          this$.lb = lb;
          this$.rb = rb;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Parens2.prototype.children = ["it"];
        Parens2.prototype.show = function() {
          return this.string && '""';
        };
        prototype.delegate(["isComplex", "isCallable", "isArray", "isRegex", "isNextUnreachable", "getRef"], function(it) {
          return this.it[it]();
        });
        Parens2.prototype.isString = function() {
          return this.string || this.it.isString();
        };
        Parens2.prototype.unparen = function() {
          if (this.keep) {
            return this;
          } else {
            return this.it.unparen();
          }
        };
        Parens2.prototype.compile = function(o, level) {
          var it;
          level == null && (level = o.level);
          it = this.it;
          it.cond || (it.cond = this.cond), it["void"] || (it["void"] = this["void"]);
          if (this.calling && (!level || this["void"])) {
            it.head.hushed = true;
          }
          if (!(this.keep || this.newed || level >= LEVEL_OP + PREC[it.op])) {
            return (it.front = this.front, it).compile(o, level || LEVEL_PAREN);
          }
          if (it.isStatement()) {
            return it.compileClosure(o);
          } else {
            return sn(null, sn(this.lb, "("), it.compile(o, LEVEL_PAREN), sn(this.rb, ")"));
          }
        };
        Parens2.prototype.maybeKey = THIS;
        Parens2.prototype.extractKeyRef = function(o, assign, tempOwner) {
          var v, ref$2, ref, key, val;
          if (tempOwner != null && (v = this.it) instanceof Var && (ref$2 = v.temp, delete v.temp, ref$2)) {
            (tempOwner.temps || (tempOwner.temps = [])).push(v.value);
          }
          if (this.it instanceof Chain && assign) {
            ref$2 = this.it.cacheReference(o), this.it = ref$2[0], ref = ref$2[1];
            return Parens2(ref);
          }
          ref$2 = this.it.cache(o, true), key = ref$2[0], val = ref$2[1];
          if (assign) {
            ref$2 = [val, key], key = ref$2[0], val = ref$2[1];
          }
          this.it = val.unparen();
          return Parens2(key);
        };
        Parens2.prototype.rewriteShorthand = function(o) {
          var that;
          if (that = this.it.rewriteShorthand(o)) {
            this.it = that;
          }
        };
        return Parens2;
      })(Node);
      exports.Splat = Splat = (function(superclass) {
        var ref$2, prototype = extend$((import$(Splat2, superclass).displayName = "Splat", Splat2), superclass).prototype, constructor = Splat2;
        function Splat2(it, filler) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.it = it;
          this$.filler = filler;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        ref$2 = Parens.prototype, prototype.children = ref$2.children, prototype.isComplex = ref$2.isComplex;
        Splat2.prototype.isAssignable = YES;
        Splat2.prototype.assigns = function() {
          return this.it.assigns();
        };
        Splat2.prototype.compile = function() {
          return this.carp("invalid splat");
        };
        Splat2.compileArray = function(o, list, apply) {
          var index, i$, len$, node, args, atoms, ref$3;
          expand(list);
          index = 0;
          for (i$ = 0, len$ = list.length; i$ < len$; ++i$) {
            node = list[i$];
            if (node instanceof Splat2) {
              break;
            }
            ++index;
          }
          if (index >= list.length) {
            return sn(this, "");
          }
          if (!list[1]) {
            return sn(this, (apply ? Object : ensureArray)(list[0].it).compile(o, LEVEL_LIST));
          }
          args = [];
          atoms = [];
          for (i$ = 0, len$ = (ref$3 = list.splice(index, 9e9)).length; i$ < len$; ++i$) {
            node = ref$3[i$];
            if (node instanceof Splat2) {
              if (atoms.length) {
                args.push(Arr(atoms.splice(0, 9e9)));
              }
              args.push(ensureArray(node.it));
            } else {
              atoms.push(node);
            }
          }
          if (atoms.length) {
            args.push(Arr(atoms));
          }
          return sn(null, (index ? Arr(list) : args.shift()).compile(o, LEVEL_CALL), sn(this, ".concat("), List.compile(o, args), sn(this, ")"));
        };
        function expand(nodes) {
          var index, node, it;
          index = -1;
          while (node = nodes[++index]) {
            if (node instanceof Splat2) {
              it = node.it;
              if (it.isEmpty()) {
                nodes.splice(index--, 1);
              } else if (it instanceof Arr) {
                nodes.splice.apply(nodes, [index, 1].concat(arrayFrom$(expand(it.items))));
                index += it.items.length - 1;
              }
            }
          }
          return nodes;
        }
        function ensureArray(node) {
          if (node.isArray()) {
            return node;
          }
          util("slice");
          return Call.make(Util("arrayFrom"), [node]);
        }
        return Splat2;
      })(Node);
      exports.Jump = Jump = (function(superclass) {
        var prototype = extend$((import$(Jump2, superclass).displayName = "Jump", Jump2), superclass).prototype, constructor = Jump2;
        function Jump2(verb, label) {
          this.verb = verb;
          this.label = label;
        }
        Jump2.prototype.show = function() {
          var that;
          return (this.verb || "") + ((that = this.label) ? " " + that : "");
        };
        Jump2.prototype.isStatement = YES;
        Jump2.prototype.makeReturn = THIS;
        Jump2.prototype.isNextUnreachable = YES;
        Jump2.prototype.getJump = function(ctx) {
          var that, ref$2;
          ctx || (ctx = {});
          if (!ctx[this.verb]) {
            return this;
          }
          if (that = this.label) {
            return !in$(that, (ref$2 = ctx.labels) != null ? ref$2 : ctx.labels = []) && this;
          }
        };
        Jump2.prototype.compileNode = function(o) {
          var that, ref$2;
          if (that = this.label) {
            in$(that, (ref$2 = o.labels) != null ? ref$2 : o.labels = []) || this.carp('unknown label "' + that + '"');
          } else {
            o[this.verb] || this.carp("stray " + this.verb);
          }
          return sn(this, this.show() + ";");
        };
        Jump2.extended = function(sub) {
          sub.prototype.children = ["it"];
          this[sub.displayName.toLowerCase()] = sub;
        };
        return Jump2;
      })(Node);
      exports.Throw = Throw = (function(superclass) {
        var prototype = extend$((import$(Throw2, superclass).displayName = "Throw", Throw2), superclass).prototype, constructor = Throw2;
        function Throw2(it) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.it = it;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Throw2.prototype.getJump = VOID;
        Throw2.prototype.compileNode = function(o) {
          var ref$2;
          return sn(this, "throw ", ((ref$2 = this.it) != null ? ref$2.compile(o, LEVEL_PAREN) : void 0) || "null", ";");
        };
        return Throw2;
      })(Jump);
      exports.Return = Return = (function(superclass) {
        var prototype = extend$((import$(Return2, superclass).displayName = "Return", Return2), superclass).prototype, constructor = Return2;
        function Return2(it) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          if (it && it.value !== "void") {
            this$.it = it;
          }
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Return2.prototype.getJump = THIS;
        Return2.prototype.compileNode = function(o) {
          var that;
          return sn.apply(null, [this, "return"].concat(
            (that = this.it) ? [" ", that.compile(o, LEVEL_PAREN)] : [],
            [";"]
          ));
        };
        return Return2;
      })(Jump);
      exports.While = While = (function(superclass) {
        var prototype = extend$((import$(While2, superclass).displayName = "While", While2), superclass).prototype, constructor = While2;
        function While2(test, un, mode) {
          this.un = un;
          mode && (mode instanceof Node ? this.update = mode : this.post = true);
          if (this.post || test.value !== "" + !un) {
            this.test = test;
          }
        }
        While2.prototype.children = ["test", "body", "update", "else"];
        While2.prototype.aSource = "test";
        While2.prototype.aTargets = ["body", "update"];
        While2.prototype.show = function() {
          return [this.un ? "!" : void 0, this.post ? "do" : void 0].join("");
        };
        prototype.isStatement = prototype.isArray = YES;
        While2.prototype.makeComprehension = function(toAdd, loops) {
          this.isComprehension = true;
          while (loops.length) {
            toAdd = loops.pop().addBody(Block(toAdd));
            if (!toAdd.isComprehension) {
              toAdd.inComprehension = true;
            }
          }
          return this.addBody(Block(toAdd));
        };
        While2.prototype.getJump = function(ctx) {
          var i$, ref$2, ref1$, len$, node;
          ctx || (ctx = {});
          ctx["continue"] = true;
          ctx["break"] = true;
          for (i$ = 0, len$ = (ref$2 = ((ref1$ = this.body) != null ? ref1$.lines : void 0) || []).length; i$ < len$; ++i$) {
            node = ref$2[i$];
            if (node.getJump(ctx)) {
              return node;
            }
          }
        };
        While2.prototype.addBody = function(body) {
          var top;
          this.body = body;
          if (this.guard) {
            this.body = Block(If(this.guard, this.body));
          }
          top = this.body.lines[0];
          if ((top != null ? top.verb : void 0) === "continue" && !top.label) {
            this.body.lines.length = 0;
          }
          return this;
        };
        While2.prototype.addGuard = function(guard) {
          this.guard = guard;
          return this;
        };
        While2.prototype.addObjComp = function(objComp) {
          this.objComp = objComp != null ? objComp : true;
          return this;
        };
        While2.prototype.makeReturn = function(it) {
          var last, ref$2, ref1$, ref2$;
          if (this.hasReturned) {
            return this;
          }
          if (it) {
            if (this.objComp) {
              this.body = Block(this.body.makeReturn(it, true));
            } else {
              if (!(this.body || this.index)) {
                this.addBody(Block(Var(this.index = "ridx$")));
              }
              last = (ref$2 = this.body.lines) != null ? ref$2[ref$2.length - 1] : void 0;
              if ((this.isComprehension || this.inComprehension) && !(last != null && last.isComprehension)) {
                (ref1$ = this.body).makeReturn.apply(ref1$, arguments);
                if ((ref1$ = this["else"]) != null) {
                  ref1$.makeReturn.apply(ref1$, arguments);
                }
                this.hasReturned = true;
              } else {
                this.resVar = it;
                if ((ref2$ = this["else"]) != null) {
                  ref2$.makeReturn.apply(ref2$, arguments);
                }
              }
            }
          } else {
            this.getJump() || (this.returns = true);
          }
          return this;
        };
        While2.prototype.compileNode = function(o) {
          var test, ref$2, head, that;
          o.loop = true;
          this.test && (this.un ? this.test = this.test.invert() : this.anaphorize());
          if (this.post) {
            return sn(null, sn(this, "do {"), this.compileBody((o.indent += TAB, o)));
          }
          test = ((ref$2 = this.test) != null ? ref$2.compile(o, LEVEL_PAREN) : void 0) || "";
          if (!(this.update || this["else"])) {
            head = !snEmpty(test) ? [sn(this, "while ("), test] : [sn(this, "for (;;")];
          } else {
            head = [sn(this, "for (")];
            if (this["else"]) {
              head.push(this.yet = o.scope.temporary("yet"), " = true");
            }
            head.push(sn(this, ";"), test.toString() && " ", test, sn(this, ";"));
            if (that = this.update) {
              head.push(" ", that.compile(o, LEVEL_PAREN));
            }
          }
          return sn.apply(null, [null].concat(arrayFrom$(head), [sn(this, ") {"), this.compileBody((o.indent += TAB, o))]));
        };
        While2.prototype.compileBody = function(o) {
          var lines, yet, tab, code, ret, mid, empty, _resultName, getResultName, last, hasLoop, res, temp, key$, ref$2, bodyCode, this$ = this;
          o["break"] = o["continue"] = true;
          lines = this.body.lines, yet = this.yet, tab = this.tab;
          code = [];
          ret = [];
          mid = [];
          empty = this.objComp ? "{}" : "[]";
          getResultName = function() {
            return _resultName != null ? _resultName : _resultName = o.scope.temporary(this$.objComp ? "resultObj" : "results");
          };
          last = lines != null ? lines[lines.length - 1] : void 0;
          if (!(this.isComprehension || this.inComprehension) || last != null && last.isComprehension) {
            hasLoop = false;
            if (last != null) {
              last.traverseChildren(function(it) {
                var ref$3;
                if (it instanceof Block && (ref$3 = it.lines)[ref$3.length - 1] instanceof While2) {
                  hasLoop = true;
                }
              });
            }
            if (this.returns && !this.resVar) {
              this.resVar = res = o.scope.assign(getResultName(), empty);
            }
            if (this.resVar && (last instanceof While2 || hasLoop)) {
              temp = o.scope.temporary("lresult");
              lines.unshift(Assign(Var(temp), lines[lines.length - 1].objComp ? Obj() : Arr(), "="));
              if (lines[key$ = lines.length - 1] != null) {
                lines[key$] = lines[key$].makeReturn(temp);
              }
              mid.push(TAB, Chain(Var(this.resVar)).add(Index(Key("push"), ".", true)).add(Call([Chain(Var(temp))])).compile(o), ";\n" + this.tab);
            } else {
              this.hasReturned = true;
              if (this.resVar) {
                this.body.makeReturn(this.resVar);
              }
            }
          }
          if (this.returns) {
            if (!last instanceof While2 && !this.hasReturned || this.isComprehension || this.inComprehension) {
              if (lines[key$ = lines.length - 1] != null) {
                lines[key$] = lines[key$].makeReturn(res = o.scope.assign(getResultName(), empty), this.objComp);
              }
            }
            ret.push("\n" + this.tab + "return ", res || empty, ";");
            if ((ref$2 = this["else"]) != null) {
              ref$2.makeReturn();
            }
          }
          yet && lines.unshift(JS(yet + " = false;"));
          if (!snEmpty(bodyCode = this.body.compile(o, LEVEL_TOP))) {
            code.push("\n", bodyCode, "\n" + tab);
          }
          code.push.apply(code, mid);
          code.push("}");
          if (this.post) {
            code.push(sn(this, " while ("), this.test.compile((o.tab = tab, o), LEVEL_PAREN), sn(this, ");"));
          }
          if (yet) {
            code.push(sn(this, " if ("), yet, sn(this, ") "), this.compileBlock(o, Block(this["else"])));
            o.scope.free(yet);
          }
          return sn.apply(null, [null].concat(arrayFrom$(code), arrayFrom$(ret)));
        };
        return While2;
      })(Node);
      exports.For = For = (function(superclass) {
        var prototype = extend$((import$(For2, superclass).displayName = "For", For2), superclass).prototype, constructor = For2;
        function For2(it) {
          var i$, x$, ref$2, len$;
          importAll$(this, it);
          if (this.item instanceof Var && !this.item.value) {
            this.item = null;
          }
          for (i$ = 0, len$ = (ref$2 = this.kind || []).length; i$ < len$; ++i$) {
            x$ = ref$2[i$];
            this[x$] = true;
          }
          if (this.own && !this.object) {
            this.carp("`for own` requires `of`");
          }
        }
        For2.prototype.children = ["item", "source", "from", "to", "step", "body"];
        For2.prototype.aSource = null;
        For2.prototype.show = function() {
          return (this.kind || []).concat(this.index).join(" ");
        };
        For2.prototype.addBody = function(body) {
          var ref$2, that, assignments, x$, assigned, name, ref1$;
          if (this["let"]) {
            if (ref$2 = this.ref, delete this.ref, ref$2) {
              this.item = Literal("..");
            }
            if (that = (ref$2 = this.item) != null ? ref$2.rewriteShorthand() : void 0) {
              this.item = that;
            }
            assignments = (x$ = [], (that = this.index) && x$.push(Assign(Var(that), Literal("index$$"))), (that = this.item) && x$.push(Assign(that, Literal("item$$"))), x$);
            body = Block(this.guard ? (assigned = (function() {
              var i$, x$2, ref$3, len$, j$, ref1$2, len1$, results$ = [];
              for (i$ = 0, len$ = (ref$3 = assignments).length; i$ < len$; ++i$) {
                x$2 = ref$3[i$];
                if (that = x$2.assigns()) {
                  for (j$ = 0, len1$ = (ref1$2 = that).length; j$ < len1$; ++j$) {
                    name = ref1$2[j$];
                    results$.push(Var(name));
                  }
                }
              }
              return results$;
            })(), assignments.concat([If((ref1$ = this.guard, delete this.guard, ref1$), Call["let"](assigned, body))])) : Call["let"](assignments, body));
          }
          superclass.prototype.addBody.call(this, body);
          if (this["let"]) {
            delete this.index;
            delete this.item;
          }
          return this;
        };
        For2.prototype.isNextUnreachable = NO;
        For2.prototype.compileNode = function(o) {
          var temps, idx, ref$2, pvar, step, tvar, tail, fvar, vars, eq, cond, svar, srcPart, lvar, head, that, body;
          o.loop = true;
          temps = this.temps = [];
          if (this.object && this.index) {
            o.scope.declare(idx = this.index);
          } else {
            temps.push(idx = o.scope.temporary("i"));
          }
          if (!this.body) {
            this.addBody(Block(Var(idx)));
          }
          if (!this.object) {
            ref$2 = (this.step || Literal(1)).compileLoopReference(o, "step"), pvar = ref$2[0], step = ref$2[1];
            pvar === step || temps.push(pvar);
          }
          if (this.from) {
            if (this.ref) {
              this.item = Var(idx);
            }
            ref$2 = this.to.compileLoopReference(o, "to"), tvar = ref$2[0], tail = ref$2[1];
            fvar = this.from.compile(o, LEVEL_LIST);
            vars = idx + " = " + fvar;
            if (tail !== tvar) {
              vars += ", " + tail;
              temps.push(tvar);
            }
            if (!this.step && +fvar > +tvar) {
              pvar = step = -1;
            }
            eq = this.op === "til" ? "" : "=";
            cond = +pvar ? idx + " " + "<>".charAt(pvar < 0) + eq + " " + tvar : pvar + " < 0 ? " + idx + " >" + eq + " " + tvar + " : " + idx + " <" + eq + " " + tvar;
          } else {
            if (this.ref) {
              this.item = Var(o.scope.temporary("x"));
            }
            if (this.item || this.object && this.own || this["let"]) {
              ref$2 = this.source.compileLoopReference(o, "ref", !this.object, true), svar = ref$2[0], srcPart = ref$2[1];
              svar === srcPart || temps.push(svar);
            } else {
              svar = srcPart = this.source.compile(o, LEVEL_PAREN);
            }
            if (!this.object) {
              if (0 > pvar && ~~pvar === +pvar) {
                vars = idx + " = " + srcPart + ".length - 1";
                cond = idx + " >= 0";
              } else {
                temps.push(lvar = o.scope.temporary("len"));
                vars = idx + " = 0, " + lvar + " = " + srcPart + ".length";
                cond = idx + " < " + lvar;
              }
            }
          }
          this["else"] && (this.yet = o.scope.temporary("yet"));
          head = [sn(this, "for (")];
          if (this.object) {
            head.push(idx, " in ");
          }
          if (that = this.yet) {
            head.push(that, " = true, ");
          }
          if (this.object) {
            head.push(srcPart);
          } else {
            step === pvar || (vars += ", " + step);
            head.push(vars, "; ", cond, "; " + (1 == Math.abs(pvar) ? (pvar < 0 ? "--" : "++") + idx : idx + (pvar < 0 ? " -= " + pvar.toString().slice(1) : " += " + pvar)));
          }
          this.own && head.push(sn(this, ") if ("), o.scope.assign("own$", "{}.hasOwnProperty"), ".call(", svar, ", ", idx, ")");
          head.push(sn(this, ") {"));
          if (this["let"]) {
            this.body.traverseChildren(function(it) {
              switch (it.value) {
                case "index$$":
                  it.value = idx;
                  break;
                case "item$$":
                  it.value = svar + "[" + idx + "]";
              }
            });
          }
          o.indent += TAB;
          if (this.index && !this.object) {
            head.push("\n" + o.indent, Assign(Var(this.index), JS(idx)).compile(o, LEVEL_TOP), ";");
          }
          if (this.item && !this.item.isEmpty() && !this.from) {
            head.push("\n" + o.indent, Assign(this.item, JS(svar + "[" + idx + "]")).compile(o, LEVEL_TOP), ";");
          }
          if (this.ref) {
            o.ref = this.item.value;
          }
          body = this.compileBody(o);
          if ((this.item || this.index && !this.object) && "}" === body.toString().charAt(0)) {
            head.push("\n" + this.tab);
          }
          return sn.apply(null, [null].concat(arrayFrom$(head), [body]));
        };
        return For2;
      })(While);
      exports.StepSlice = StepSlice = (function(superclass) {
        var prototype = extend$((import$(StepSlice2, superclass).displayName = "StepSlice", StepSlice2), superclass).prototype, constructor = StepSlice2;
        StepSlice2.prototype.makeReturn = function(makeReturnArg) {
          this.makeReturnArg = makeReturnArg;
          return superclass.prototype.makeReturn.apply(this, arguments);
        };
        StepSlice2.prototype.compileNode = function(o) {
          var ref$2, sub, ref, temps, code;
          this.index = o.scope.temporary("x");
          ref$2 = this.target.unwrap().cache(o), sub = ref$2[0], ref = ref$2[1], temps = ref$2[2];
          this.guard = Binary("<", Literal(this.index), Chain(ref).add(Index(Key("length"))));
          this.makeComprehension(Chain(ref).add(Index(Literal(this.index))), this);
          if (this.makeReturnArg != null) {
            this.makeReturn(this.makeReturnArg);
          }
          code = [];
          if (temps) {
            code.push(sub.compile(o), ";\n" + o.indent);
          }
          code.push(superclass.prototype.compileNode.apply(this, arguments));
          return sn.apply(null, [this].concat(arrayFrom$(code)));
        };
        function StepSlice2() {
          StepSlice2.superclass.apply(this, arguments);
        }
        return StepSlice2;
      })(For);
      exports.Try = Try = (function(superclass) {
        var prototype = extend$((import$(Try2, superclass).displayName = "Try", Try2), superclass).prototype, constructor = Try2;
        function Try2(attempt, thrown, recovery, ensure) {
          var ref$2;
          this.attempt = attempt;
          this.thrown = thrown;
          this.recovery = recovery;
          this.ensure = ensure;
          if ((ref$2 = this.recovery) != null) {
            ref$2.lines.unshift(Assign(this.thrown || Var("e"), Var("e$")));
          }
        }
        Try2.prototype.children = ["attempt", "recovery", "ensure"];
        Try2.prototype.show = function() {
          return this.thrown;
        };
        Try2.prototype.isStatement = YES;
        Try2.prototype.isCallable = function() {
          var ref$2;
          return ((ref$2 = this.recovery) != null ? ref$2.isCallable() : void 0) && this.attempt.isCallable();
        };
        Try2.prototype.getJump = function(it) {
          var ref$2;
          return this.attempt.getJump(it) || ((ref$2 = this.recovery) != null ? ref$2.getJump(it) : void 0);
        };
        Try2.prototype.isNextUnreachable = function() {
          var ref$2, that;
          return ((ref$2 = this.ensure) != null ? ref$2.isNextUnreachable() : void 0) || this.attempt.isNextUnreachable() && ((that = this.recovery) != null ? that.isNextUnreachable() : true);
        };
        Try2.prototype.makeReturn = function() {
          var ref$2;
          this.attempt = (ref$2 = this.attempt).makeReturn.apply(ref$2, arguments);
          if (this.recovery != null) {
            this.recovery = (ref$2 = this.recovery).makeReturn.apply(ref$2, arguments);
          }
          return this;
        };
        Try2.prototype.compileNode = function(o) {
          var code, that;
          o.indent += TAB;
          code = [sn(this, "try "), this.compileBlock(o, this.attempt)];
          if (that = this.recovery || !this.ensure && JS("")) {
            code.push(sn(that, " catch (e$) "), this.compileBlock(o, that));
          }
          if (that = this.ensure) {
            code.push(sn(that, " finally "), this.compileBlock(o, that));
          }
          return sn.apply(null, [null].concat(arrayFrom$(code)));
        };
        return Try2;
      })(Node);
      exports.Switch = Switch = (function(superclass) {
        var prototype = extend$((import$(Switch2, superclass).displayName = "Switch", Switch2), superclass).prototype, constructor = Switch2;
        function Switch2(type, topic, cases, $default) {
          var last, ref$2;
          this.type = type;
          this.topic = topic;
          this.cases = cases;
          this["default"] = $default;
          if (type === "match") {
            if (topic) {
              this.topic = Arr(topic);
            }
          } else {
            if (topic) {
              if (topic.length > 1) {
                throw "can't have more than one topic in switch statement";
              }
              this.topic = this.topic[0];
            }
          }
          if (this.cases.length && (last = (ref$2 = this.cases)[ref$2.length - 1]).tests.length === 1 && last.tests[0] instanceof Var && last.tests[0].value === "_") {
            this.cases.pop();
            this["default"] = last.body;
          }
        }
        Switch2.prototype.children = ["topic", "cases", "default"];
        Switch2.prototype.aSource = "topic";
        Switch2.prototype.aTargets = ["cases", "default"];
        Switch2.prototype.show = function() {
          return this.type;
        };
        Switch2.prototype.isStatement = YES;
        Switch2.prototype.isCallable = function() {
          var i$, ref$2, len$, c;
          for (i$ = 0, len$ = (ref$2 = this.cases).length; i$ < len$; ++i$) {
            c = ref$2[i$];
            if (!c.isCallable()) {
              return false;
            }
          }
          if (this["default"]) {
            return this["default"].isCallable();
          } else {
            return true;
          }
        };
        Switch2.prototype.getJump = function(ctx) {
          var i$, ref$2, len$, c, that;
          ctx || (ctx = {});
          ctx["break"] = true;
          for (i$ = 0, len$ = (ref$2 = this.cases).length; i$ < len$; ++i$) {
            c = ref$2[i$];
            if (that = c.body.getJump(ctx)) {
              return that;
            }
          }
          return (ref$2 = this["default"]) != null ? ref$2.getJump(ctx) : void 0;
        };
        Switch2.prototype.isNextUnreachable = function() {
          var i$, ref$2, len$, c;
          for (i$ = 0, len$ = (ref$2 = this.cases).length; i$ < len$; ++i$) {
            c = ref$2[i$];
            if (!c.body.isNextUnreachable()) {
              return false;
            }
          }
          return (ref$2 = this["default"]) != null ? ref$2.isNextUnreachable() : void 0;
        };
        Switch2.prototype.makeReturn = function() {
          var i$, ref$2, len$, c;
          for (i$ = 0, len$ = (ref$2 = this.cases).length; i$ < len$; ++i$) {
            c = ref$2[i$];
            c.makeReturn.apply(c, arguments);
          }
          if ((ref$2 = this["default"]) != null) {
            ref$2.makeReturn.apply(ref$2, arguments);
          }
          return this;
        };
        Switch2.prototype.compileNode = function(o) {
          var tab, topic, ref$2, targetNode, target, t, code, stop, i$, len$, i, c, that;
          tab = this.tab;
          topic = this.type === "match" ? (this.topic && (ref$2 = Chain(this.topic).cacheReference(o), targetNode = ref$2[0], target = ref$2[1]), t = target ? [targetNode] : [], Block(t.concat([Literal("false")])).compile(o, LEVEL_PAREN)) : !!this.topic && this.anaphorize().compile(o, LEVEL_PAREN);
          code = [sn(this, "switch (", snSafe(topic), ") {\n")];
          stop = this["default"] || this.cases.length - 1;
          o["break"] = true;
          for (i$ = 0, len$ = (ref$2 = this.cases).length; i$ < len$; ++i$) {
            i = i$;
            c = ref$2[i$];
            code.push(c.compileCase(o, tab, i === stop, this.type === "match" || !topic, this.type, target));
          }
          if (this["default"]) {
            o.indent = tab + TAB;
            if (that = this["default"].compile(o, LEVEL_TOP)) {
              code.push(tab + "default:\n", that, "\n");
            }
          }
          return sn.apply(null, [null].concat(arrayFrom$(code), [tab + "}"]));
        };
        return Switch2;
      })(Node);
      exports.Case = Case = (function(superclass) {
        var prototype = extend$((import$(Case2, superclass).displayName = "Case", Case2), superclass).prototype, constructor = Case2;
        function Case2(tests, body) {
          this.tests = tests;
          this.body = body;
        }
        Case2.prototype.children = ["tests", "body"];
        Case2.prototype.isCallable = function() {
          return this.body.isCallable();
        };
        Case2.prototype.makeReturn = function() {
          var ref$2, ref1$;
          if (((ref$2 = (ref1$ = this.body.lines)[ref1$.length - 1]) != null ? ref$2.value : void 0) !== "fallthrough") {
            (ref1$ = this.body).makeReturn.apply(ref1$, arguments);
          }
          return this;
        };
        Case2.prototype.compileCase = function(o, tab, nobr, bool, type, target) {
          var tests, i$, ref$2, len$, test, j$, ref1$, len1$, t, i, tar, binary, that, code, lines, last, ft, bodyCode;
          tests = [];
          for (i$ = 0, len$ = (ref$2 = this.tests).length; i$ < len$; ++i$) {
            test = ref$2[i$];
            if (test instanceof Arr && type !== "match") {
              for (j$ = 0, len1$ = (ref1$ = test.items).length; j$ < len1$; ++j$) {
                t = ref1$[j$];
                tests.push(t);
              }
            } else {
              tests.push(test);
            }
          }
          tests.length || tests.push(Literal("void"));
          if (type === "match") {
            for (i$ = 0, len$ = tests.length; i$ < len$; ++i$) {
              i = i$;
              test = tests[i$];
              tar = Chain(target).add(Index(Literal(i), ".", true));
              tests[i] = Parens(Chain(test).autoCompare(target ? [tar] : null));
            }
          }
          if (bool) {
            binary = type === "match" ? "&&" : "||";
            t = tests[0];
            i = 0;
            while (that = tests[++i]) {
              t = Binary(binary, t, that);
            }
            tests = [(this.t = t, this.aSource = "t", this.aTargets = ["body"], this).anaphorize().invert()];
          }
          code = [];
          for (i$ = 0, len$ = tests.length; i$ < len$; ++i$) {
            t = tests[i$];
            code.push(tab, sn(t, "case ", t.compile(o, LEVEL_PAREN), ":\n"));
          }
          lines = this.body.lines;
          last = lines[lines.length - 1];
          if (ft = (last != null ? last.value : void 0) === "fallthrough") {
            lines[lines.length - 1] = JS("// fallthrough");
          }
          o.indent = tab += TAB;
          if (!snEmpty(bodyCode = this.body.compile(o, LEVEL_TOP))) {
            code.push(bodyCode, "\n");
          }
          if (!(nobr || ft || last != null && last.isNextUnreachable())) {
            code.push(tab + "break;\n");
          }
          return sn.apply(null, [null].concat(arrayFrom$(code)));
        };
        return Case2;
      })(Node);
      exports.If = If = (function(superclass) {
        var prototype = extend$((import$(If2, superclass).displayName = "If", If2), superclass).prototype, constructor = If2;
        function If2($if, then, un) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$["if"] = $if;
          this$.then = then;
          this$.un = un;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        If2.prototype.children = ["if", "then", "else"];
        If2.prototype.aSource = "if";
        If2.prototype.aTargets = ["then"];
        If2.prototype.show = function() {
          return this.un && "!";
        };
        If2.prototype.terminator = "";
        prototype.delegate(["isCallable", "isArray", "isString", "isRegex", "isNextUnreachable"], function(it) {
          var ref$2;
          return ((ref$2 = this["else"]) != null ? ref$2[it]() : void 0) && this.then[it]();
        });
        If2.prototype.getJump = function(it) {
          var ref$2;
          return this.then.getJump(it) || ((ref$2 = this["else"]) != null ? ref$2.getJump(it) : void 0);
        };
        If2.prototype.makeReturn = function() {
          var ref$2;
          this.then = (ref$2 = this.then).makeReturn.apply(ref$2, arguments);
          if (this["else"] != null) {
            this["else"] = (ref$2 = this["else"]).makeReturn.apply(ref$2, arguments);
          }
          return this;
        };
        If2.prototype.compileNode = function(o) {
          if (this.un) {
            this["if"] = this["if"].invert();
          } else {
            this.soak || this.anaphorize();
          }
          if (o.level) {
            return this.compileExpression(o);
          } else {
            return this.compileStatement(o);
          }
        };
        If2.prototype.compileStatement = function(o) {
          var code, els;
          code = [sn(this, "if (", this["if"].compile(o, LEVEL_PAREN), ") ")];
          o.indent += TAB;
          code.push(this.compileBlock(o, Block(this.then)));
          if (!(els = this["else"])) {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          }
          return sn.apply(null, [null].concat(
            arrayFrom$(code),
            [
              sn(els, " else "),
              els instanceof constructor ? els.compile((o.indent = this.tab, o), LEVEL_TOP) : this.compileBlock(o, els)
            ]
          ));
        };
        If2.prototype.compileExpression = function(o) {
          var thn, els, code, pad;
          thn = this.then, els = this["else"] || Literal("void");
          this["void"] && (thn["void"] = els["void"] = true);
          if (!this["else"] && (this.cond || this["void"])) {
            return Parens(Binary("&&", this["if"], thn)).compile(o);
          }
          code = [sn(this, this["if"].compile(o, LEVEL_COND))];
          pad = els.isComplex() ? "\n" + (o.indent += TAB) : " ";
          code.push(pad + "", sn(thn, "? "), thn.compile(o, LEVEL_LIST), pad + "", sn(els, ": "), els.compile(o, LEVEL_LIST));
          if (o.level < LEVEL_COND) {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          } else {
            return sn(null, "(", code, ")");
          }
        };
        If2.unfoldSoak = function(o, parent, name) {
          var that;
          if (that = parent[name].unfoldSoak(o)) {
            parent[name] = that.then;
            return that.cond = parent.cond, that["void"] = parent["void"], that.then = Chain(parent), that;
          }
        };
        return If2;
      })(Node);
      exports.Label = Label = (function(superclass) {
        var ref$2, prototype = extend$((import$(Label2, superclass).displayName = "Label", Label2), superclass).prototype, constructor = Label2;
        function Label2(label, it) {
          var fun;
          this.label = label || "_";
          this.it = it;
          if (this.it.curried) {
            this.carp("can't use label with a curried function (attempted label '" + this.label + "')");
          }
          if (fun = (it instanceof Fun || it instanceof Class) && it || it.calling && it.it.head) {
            fun.name || (fun.name = this.label, fun.labeled = true);
            return it;
          }
        }
        ref$2 = Parens.prototype, prototype.children = ref$2.children, prototype.isCallable = ref$2.isCallable, prototype.isArray = ref$2.isArray;
        Label2.prototype.show = function() {
          return this.label;
        };
        Label2.prototype.isStatement = YES;
        Label2.prototype.getJump = function(ctx) {
          var ref$3;
          ctx || (ctx = {});
          ((ref$3 = ctx.labels) != null ? ref$3 : ctx.labels = []).push(this.label);
          return this.it.getJump((ctx["break"] = true, ctx));
        };
        Label2.prototype.makeReturn = function() {
          var ref$3;
          this.it = (ref$3 = this.it).makeReturn.apply(ref$3, arguments);
          return this;
        };
        Label2.prototype.compileNode = function(o) {
          var label, it, labels;
          label = this.label, it = this.it;
          labels = o.labels = arrayFrom$(o.labels || []);
          if (in$(label, labels)) {
            this.carp('duplicate label "' + label + '"');
          }
          labels.push(label);
          it.isStatement() || (it = Block(it));
          return sn(null, sn(this, label, ": "), it instanceof Block ? (o.indent += TAB, this.compileBlock(o, it)) : it.compile(o));
        };
        return Label2;
      })(Node);
      exports.Cascade = Cascade = (function(superclass) {
        var prototype = extend$((import$(Cascade2, superclass).displayName = "Cascade", Cascade2), superclass).prototype, constructor = Cascade2;
        function Cascade2(input, output, prog1) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.input = input;
          this$.output = output;
          this$.prog1 = prog1;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Cascade2.prototype.show = function() {
          return this.prog1;
        };
        Cascade2.prototype.children = ["input", "output"];
        Cascade2.prototype.terminator = "";
        prototype.delegate(["isCallable", "isArray", "isString", "isRegex"], function(it) {
          return this[this.prog1 ? "input" : "output"][it]();
        });
        Cascade2.prototype.getJump = function(it) {
          return this.output.getJump(it);
        };
        Cascade2.prototype.makeReturn = function(ret) {
          this.ret = ret;
          return this;
        };
        Cascade2.prototype.compileNode = function(o) {
          var level, input, output, prog1, ref, ref$2, code, out;
          level = o.level;
          input = this.input, output = this.output, prog1 = this.prog1, ref = this.ref;
          if (prog1 && ("ret" in this || level && !this["void"])) {
            output.add((ref$2 = Literal(".."), ref$2.cascadee = true, ref$2));
          }
          if ("ret" in this) {
            output = output.makeReturn(this.ret);
          }
          if (ref) {
            prog1 || (output = Assign(Var(ref), output));
          } else {
            ref = o.scope.temporary("x");
          }
          if (input instanceof Cascade2) {
            input.ref = ref;
          } else {
            input && (input = Assign(Var(ref), input));
          }
          o.level && (o.level = LEVEL_PAREN);
          code = [input.compile(o)];
          out = Block(output).compile((o.ref = new String(ref), o));
          if (prog1 === "cascade" && !o.ref.erred) {
            this.carp("unreferred cascadee");
          }
          if (!level) {
            return sn.apply(null, [null].concat(arrayFrom$(code), [input.terminator, "\n", out]));
          }
          code.push(", ", out);
          if (level > LEVEL_PAREN) {
            return sn.apply(null, [null, "("].concat(arrayFrom$(code), [")"]));
          } else {
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          }
        };
        return Cascade2;
      })(Node);
      exports.JS = JS = (function(superclass) {
        var prototype = extend$((import$(JS2, superclass).displayName = "JS", JS2), superclass).prototype, constructor = JS2;
        function JS2(code, literal, comment) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.code = code;
          this$.literal = literal;
          this$.comment = comment;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        JS2.prototype.show = function() {
          if (this.comment) {
            return this.code;
          } else {
            return "`" + this.code + "`";
          }
        };
        JS2.prototype.terminator = "";
        prototype.isAssignable = prototype.isCallable = function() {
          return !this.comment;
        };
        JS2.prototype.compile = function(it) {
          return sn(this, snSafe(this.literal ? entab(this.code, it.indent) : this.code));
        };
        return JS2;
      })(Node);
      exports.Require = Require = (function(superclass) {
        var prototype = extend$((import$(Require2, superclass).displayName = "Require", Require2), superclass).prototype, constructor = Require2;
        function Require2(body) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.body = body;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Require2.prototype.children = ["body"];
        Require2.prototype.compile = function(o) {
          var getValue, processItem, code, i$, ref$2, len$, item, this$ = this;
          getValue = function(item2, throwError) {
            switch (false) {
              case !(item2 instanceof Key):
                return item2.name;
              case !(item2 instanceof Var):
                return item2.value;
              case !(item2 instanceof Literal):
                return item2.value;
              default:
                if (throwError) {
                  return this$.carp("invalid require! argument");
                } else {
                  return item2;
                }
            }
          };
          processItem = function(item2) {
            var ref$3, asg, value, asgValue, toAsg, main;
            ref$3 = (function() {
              var ref$4;
              switch (false) {
                case !(item2 instanceof Prop):
                  return [
                    item2.val,
                    (ref$4 = item2.key) != null ? ref$4 : item2.val
                  ];
                default:
                  return [item2, item2];
              }
            })(), asg = ref$3[0], value = ref$3[1];
            asgValue = getValue(asg);
            toAsg = toString$.call(asgValue).slice(8, -1) === "String" ? CopyL(asg, Var(nameFromPath(asgValue))) : asg;
            value = stripString(getValue(value, true));
            main = Chain(CopyL(this, Var("require"))).add(Call([Literal("'" + value + "'")]));
            return sn(item2, Assign(toAsg, main).compile(o));
          };
          if (this.body.items != null) {
            code = [];
            for (i$ = 0, len$ = (ref$2 = this.body.items).length; i$ < len$; ++i$) {
              item = ref$2[i$];
              code.push(processItem(item), ";\n" + o.indent);
            }
            code.pop();
            return sn.apply(null, [null].concat(arrayFrom$(code)));
          } else {
            return sn(null, processItem(this.body));
          }
        };
        return Require2;
      })(Node);
      exports.Util = Util = (function(superclass) {
        var prototype = extend$((import$(Util2, superclass).displayName = "Util", Util2), superclass).prototype, constructor = Util2;
        function Util2(verb) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.verb = verb;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Util2.prototype.show = Jump.prototype.show;
        Util2.prototype.isCallable = YES;
        Util2.prototype.compile = function() {
          return sn(this, util(this.verb));
        };
        Util2.Extends = function() {
          return Call.make(Util2("extend"), [arguments[0], arguments[1]]);
        };
        return Util2;
      })(Node);
      exports.Vars = Vars = (function(superclass) {
        var prototype = extend$((import$(Vars2, superclass).displayName = "Vars", Vars2), superclass).prototype, constructor = Vars2;
        function Vars2(vars) {
          var this$ = this instanceof ctor$ ? this : new ctor$();
          this$.vars = vars;
          return this$;
        }
        function ctor$() {
        }
        ctor$.prototype = prototype;
        Vars2.prototype.children = ["vars"];
        Vars2.prototype.makeReturn = THIS;
        Vars2.prototype.compile = function(o, level) {
          var i$, ref$2, len$, v, value;
          for (i$ = 0, len$ = (ref$2 = this.vars).length; i$ < len$; ++i$) {
            v = ref$2[i$], value = v.value;
            if (!(v instanceof Var)) {
              v.carp("invalid variable declaration");
            }
            if (o.scope.check(value)) {
              v.carp('redeclaration of "' + value + '"');
            }
            o.scope.declare(value, v);
          }
          return sn(this, Literal("void").compile(o, level));
        };
        return Vars2;
      })(Node);
      exports.L = function(a, b, node) {
        if (node && typeof node === "object") {
          node.first_line = a.first_line + 1;
          node.first_column = a.first_column;
          node.last_line = b.last_line + 1;
          node.last_column = b.last_column;
          node.line = a.first_line + 1;
          node.column = a.first_column;
        }
        return node;
      };
      exports.CopyL = CopyL = function(a, node) {
        if (node && typeof node === "object") {
          node.first_line = a.first_line;
          node.first_column = a.first_column;
          node.last_line = a.last_line;
          node.last_column = a.last_column;
          node.line = a.line;
          node.column = a.column;
        }
        return node;
      };
      exports.Box = function(v) {
        if (typeof v === "object") {
          return v;
        } else {
          return new v.constructor(v);
        }
      };
      exports.Decl = function(type, nodes, lno) {
        if (!nodes[0]) {
          throw SyntaxError("empty " + type + " on line " + lno);
        }
        return DECLS[type](nodes);
      };
      DECLS = {
        "export": function(lines) {
          var i, out, node, that, ref$2;
          i = -1;
          out = Util("out");
          while (node = lines[++i]) {
            if (node instanceof Block) {
              lines.splice.apply(lines, [i--, 1].concat(arrayFrom$(node.lines)));
              continue;
            }
            if (that = node instanceof Fun && node.name) {
              lines.splice(i++, 0, Assign(Chain(out, [Index(Key(that))]), Var(that)));
              continue;
            }
            lines[i] = (that = node.varName() || node instanceof Assign && node.left.varName() || node instanceof Class && ((ref$2 = node.title) != null ? ref$2.varName() : void 0)) ? Assign(Chain(out, [Index(Key(that))]), node) : Import(out, node);
          }
          return Block(lines);
        },
        "import": function(lines, all) {
          var i$, len$, i, line;
          for (i$ = 0, len$ = lines.length; i$ < len$; ++i$) {
            i = i$;
            line = lines[i$];
            lines[i] = Import(Literal("this"), line, all);
          }
          return Block(lines);
        },
        importAll: function(it) {
          return this["import"](it, true);
        },
        "const": function(lines) {
          var i$, len$, node;
          for (i$ = 0, len$ = lines.length; i$ < len$; ++i$) {
            node = lines[i$];
            node.op === "=" || node.carp("invalid constant variable declaration");
            node["const"] = true;
          }
          return Block(lines);
        },
        "var": Vars
      };
      function Scope(parent, shared) {
        this.parent = parent;
        this.shared = shared;
        this.variables = {};
      }
      ref$ = Scope.prototype;
      ref$.READ_ONLY = {
        "const": "constant",
        "function": "function",
        undefined: "undeclared"
      };
      ref$.add = function(name, type, node) {
        var t, that;
        if (node && (t = this.variables[name + "."])) {
          if (that = this.READ_ONLY[t] || this.READ_ONLY[type]) {
            node.carp("redeclaration of " + that + ' "' + name + '"');
          } else if (t === type && type === "arg") {
            node.carp('duplicate parameter "' + name + '"');
          } else if (t === "upvar") {
            node.carp('accidental shadow of "' + name + '"');
          }
          if (t === "arg" || t === "function") {
            return name;
          }
        }
        this.variables[name + "."] = type;
        return name;
      };
      ref$.get = function(name) {
        return this.variables[name + "."];
      };
      ref$.declare = function(name, node, constant) {
        var that, scope;
        if (that = this.shared) {
          if (this.check(name)) {
            return;
          }
          scope = that;
        } else {
          scope = this;
        }
        return scope.add(name, constant ? "const" : "var", node);
      };
      ref$.assign = function(name, value) {
        return this.add(name, {
          value
        });
      };
      ref$.temporary = function(name) {
        var ref$2;
        name || (name = "ref");
        while ((ref$2 = this.variables[name + "$."]) !== "reuse" && ref$2 !== void 0) {
          name = name.length < 2 && name < "z" ? String.fromCharCode(name.charCodeAt() + 1) : name.replace(/\d*$/, fn$);
        }
        return this.add(name + "$", "var");
        function fn$(it) {
          return ++it;
        }
      };
      ref$.free = function(name) {
        return this.add(name, "reuse");
      };
      ref$.check = function(name, above) {
        var type, ref$2;
        if ((type = this.variables[name + "."]) || !above) {
          return type;
        }
        return (ref$2 = this.parent) != null ? ref$2.check(name, above) : void 0;
      };
      ref$.checkReadOnly = function(name) {
        var that, ref$2, key$;
        if (that = this.READ_ONLY[this.check(name, true)]) {
          return that;
        }
        (ref$2 = this.variables)[key$ = name + "."] || (ref$2[key$] = "upvar");
        return "";
      };
      ref$.emit = function(code, tab) {
        var vrs, asn, fun, name, ref$2, type, that, val, declCode;
        vrs = [];
        asn = [];
        fun = [];
        for (name in ref$2 = this.variables) {
          type = ref$2[name];
          name = name.slice(0, -1);
          if (type === "var" || type === "const" || type === "reuse") {
            vrs.push(name, ", ");
          } else if (that = type.value) {
            if (~(val = entab(that, tab)).toString().lastIndexOf("function(", 0)) {
              if (val instanceof SourceNode) {
                snRemoveLeft(val, 8);
              } else {
                val = val.slice(8);
              }
              fun.push("function ", name, val, "\n" + tab);
            } else {
              asn.push(name, " = ", val, ", ");
            }
          }
        }
        declCode = vrs.concat(asn);
        declCode.pop();
        fun.pop();
        if (declCode.length > 0) {
          code = sn.apply(null, [this, tab + "var "].concat(arrayFrom$(declCode), [";\n", code]));
        }
        if (fun.length > 0) {
          return sn.apply(null, [this, code, "\n" + tab].concat(arrayFrom$(fun)));
        } else {
          return sn(this, code);
        }
      };
      function YES() {
        return true;
      }
      function NO() {
        return false;
      }
      function THIS() {
        return this;
      }
      function VOID() {
      }
      UTILS = {
        clone: "function(it){\n  function fun(){} fun.prototype = it;\n  return new fun;\n}",
        extend: "function(sub, sup){\n  function fun(){} fun.prototype = (sub.superclass = sup).prototype;\n  (sub.prototype = new fun).constructor = sub;\n  if (typeof sup.extended == 'function') sup.extended(sub);\n  return sub;\n}",
        bind: "function(obj, key, target){\n  return function(){ return (target || obj)[key].apply(obj, arguments) };\n}",
        "import": "function(obj, src){\n  var own = {}.hasOwnProperty;\n  for (var key in src) if (own.call(src, key)) obj[key] = src[key];\n  return obj;\n}",
        importAll: "function(obj, src){\n  for (var key in src) obj[key] = src[key];\n  return obj;\n}",
        copyWithout: "function(src, ex){\n  var obj = {}, own = {}.hasOwnProperty;\n  for (var key in src) if (own.call(src, key) && !own.call(ex, key)) obj[key] = src[key];\n  return obj;\n}",
        repeatString: "function(str, n){\n  for (var r = ''; n > 0; (n >>= 1) && (str += str)) if (n & 1) r += str;\n  return r;\n}",
        repeatArray: "function(arr, n){\n  for (var r = []; n > 0; (n >>= 1) && (arr = arr.concat(arr)))\n    if (n & 1) r.push.apply(r, arr);\n  return r;\n}",
        "in": "function(x, xs){\n  var i = -1, l = xs.length >>> 0;\n  while (++i < l) if (x === xs[i]) return true;\n  return false;\n}",
        out: "typeof exports != 'undefined' && exports || this",
        curry: "function(f, bound){\n  var context,\n  _curry = function(args) {\n    return f.length > 1 ? function(){\n      var params = args ? args.concat() : [];\n      context = bound ? context || this : this;\n      return params.push.apply(params, arguments) <\n          f.length && arguments.length ?\n        _curry.call(context, params) : f.apply(context, params);\n    } : f;\n  };\n  return _curry();\n}",
        flip: "function(f){\n  return curry$(function (x, y) { return f(y, x); });\n}",
        partialize: "function(f, args, where){\n  var context = this;\n  return function(){\n    var params = slice$.call(arguments), i,\n        len = params.length, wlen = where.length,\n        ta = args ? args.concat() : [], tw = where ? where.concat() : [];\n    for(i = 0; i < len; ++i) { ta[tw[0]] = params[i]; tw.shift(); }\n    return len < wlen && len ?\n      partialize$.apply(context, [f, ta, tw]) : f.apply(context, ta);\n  };\n}",
        not: "function(x){ return !x; }",
        compose: "function() {\n  var functions = arguments;\n  return function() {\n    var i, result;\n    result = functions[0].apply(this, arguments);\n    for (i = 1; i < functions.length; ++i) {\n      result = functions[i](result);\n    }\n    return result;\n  };\n}",
        deepEq: "function(x, y, type){\n  var toString = {}.toString, hasOwnProperty = {}.hasOwnProperty,\n      has = function (obj, key) { return hasOwnProperty.call(obj, key); };\n  var first = true;\n  return eq(x, y, []);\n  function eq(a, b, stack) {\n    var className, length, size, result, alength, blength, r, key, ref, sizeB;\n    if (a == null || b == null) { return a === b; }\n    if (a.__placeholder__ || b.__placeholder__) { return true; }\n    if (a === b) { return a !== 0 || 1 / a == 1 / b; }\n    className = toString.call(a);\n    if (toString.call(b) != className) { return false; }\n    switch (className) {\n      case '[object String]': return a == String(b);\n      case '[object Number]':\n        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);\n      case '[object Date]':\n      case '[object Boolean]':\n        return +a == +b;\n      case '[object RegExp]':\n        return a.source == b.source &&\n               a.global == b.global &&\n               a.multiline == b.multiline &&\n               a.ignoreCase == b.ignoreCase;\n    }\n    if (typeof a != 'object' || typeof b != 'object') { return false; }\n    length = stack.length;\n    while (length--) { if (stack[length] == a) { return true; } }\n    stack.push(a);\n    size = 0;\n    result = true;\n    if (className == '[object Array]') {\n      alength = a.length;\n      blength = b.length;\n      if (first) {\n        switch (type) {\n        case '===': result = alength === blength; break;\n        case '<==': result = alength <= blength; break;\n        case '<<=': result = alength < blength; break;\n        }\n        size = alength;\n        first = false;\n      } else {\n        result = alength === blength;\n        size = alength;\n      }\n      if (result) {\n        while (size--) {\n          if (!(result = size in a == size in b && eq(a[size], b[size], stack))){ break; }\n        }\n      }\n    } else {\n      if ('constructor' in a != 'constructor' in b || a.constructor != b.constructor) {\n        return false;\n      }\n      for (key in a) {\n        if (has(a, key)) {\n          size++;\n          if (!(result = has(b, key) && eq(a[key], b[key], stack))) { break; }\n        }\n      }\n      if (result) {\n        sizeB = 0;\n        for (key in b) {\n          if (has(b, key)) { ++sizeB; }\n        }\n        if (first) {\n          if (type === '<<=') {\n            result = size < sizeB;\n          } else if (type === '<==') {\n            result = size <= sizeB\n          } else {\n            result = size === sizeB;\n          }\n        } else {\n          first = false;\n          result = size === sizeB;\n        }\n      }\n    }\n    stack.pop();\n    return result;\n  }\n}",
        arrayFrom: "Array.from || function(x){return slice$.call(x);}",
        split: "''.split",
        replace: "''.replace",
        toString: "{}.toString",
        join: "[].join",
        slice: "[].slice",
        splice: "[].splice"
      };
      LEVEL_TOP = 0;
      LEVEL_PAREN = 1;
      LEVEL_LIST = 2;
      LEVEL_COND = 3;
      LEVEL_OP = 4;
      LEVEL_CALL = 5;
      (function() {
        this["&&"] = this["||"] = this["xor"] = 0.2;
        this[".&."] = this[".^."] = this[".|."] = 0.3;
        this["=="] = this["!="] = this["~="] = this["!~="] = this["==="] = this["!=="] = 0.4;
        this["<"] = this[">"] = this["<="] = this[">="] = this.of = this["instanceof"] = 0.5;
        this["<<="] = this[">>="] = this["<=="] = this[">=="] = this["++"] = 0.5;
        this[".<<."] = this[".>>."] = this[".>>>."] = 0.6;
        this["+"] = this["-"] = 0.7;
        this["*"] = this["/"] = this["%"] = 0.8;
      }).call(PREC = {
        unary: 0.9
      });
      TAB = "  ";
      ID = /^(?!\d)[\w$\xAA-\uFFDC]+$/;
      SIMPLENUM = /^\d+$/;
      function util(it) {
        return Scope.root.assign(it + "$", UTILS[it]);
      }
      function entab(code, tab) {
        return code.replace(/\n/g, "\n" + tab);
      }
      function import$(obj, src) {
        var own = {}.hasOwnProperty;
        for (var key in src) if (own.call(src, key)) obj[key] = src[key];
        return obj;
      }
      function clone$(it) {
        function fun() {
        }
        fun.prototype = it;
        return new fun();
      }
      function extend$(sub, sup) {
        function fun() {
        }
        fun.prototype = (sub.superclass = sup).prototype;
        (sub.prototype = new fun()).constructor = sub;
        if (typeof sup.extended == "function") sup.extended(sub);
        return sub;
      }
      function in$(x, xs) {
        var i = -1, l = xs.length >>> 0;
        while (++i < l) if (x === xs[i]) return true;
        return false;
      }
      function repeatArray$(arr, n) {
        for (var r = []; n > 0; (n >>= 1) && (arr = arr.concat(arr)))
          if (n & 1) r.push.apply(r, arr);
        return r;
      }
      function repeatString$(str, n) {
        for (var r = ""; n > 0; (n >>= 1) && (str += str)) if (n & 1) r += str;
        return r;
      }
      function importAll$(obj, src) {
        for (var key in src) obj[key] = src[key];
        return obj;
      }
    }
  });

  // ../../stub-events.js
  var require_stub_events = __commonJS({
    "../../stub-events.js"(exports, module) {
      init_shim_buffer();
      var EventEmitter = class {
        on() {
          return this;
        }
        emit() {
          return false;
        }
      };
      module.exports = { EventEmitter };
      module.exports.EventEmitter = EventEmitter;
    }
  });

  // lib/node.js
  var require_node = __commonJS({
    "lib/node.js"(exports, module) {
      init_shim_buffer();
      module.exports = function(LiveScript) {
        var fs, path, events;
        fs = require_stub_fs();
        path = require_stub_path();
        events = require_stub_events();
        LiveScript.run = function(code, options, arg$) {
          var filename, ref$, js, context, main, dirname, that, e;
          if (options != null) {
            filename = options.filename;
          }
          ref$ = arg$ != null ? arg$ : {}, js = ref$.js, context = ref$.context;
          main = __require.main;
          dirname = filename ? path.dirname(fs.realpathSync(filename = path.resolve(filename))) : filename = ".";
          main.paths = main.constructor._nodeModulePaths(dirname);
          main.filename = filename;
          if (!js) {
            code = LiveScript.compile(code, (ref$ = {}, import$(ref$, options), ref$.bare = true, ref$));
            if (that = code.code) {
              code = that;
            }
          }
          if (context) {
            global.__runContext = context;
            code = "return (function() {\n" + code + "\n}).call(global.__runContext);";
          }
          filename += "(js)";
          try {
            return main._compile(code, filename);
          } catch (e$) {
            e = e$;
            throw hackTrace(e, code, filename);
          }
        };
        importAll$(LiveScript, events.EventEmitter.prototype);
        __require.extensions[".ls"] = function(module2, filename) {
          var file, js, e;
          file = fs.readFileSync(filename, "utf8");
          js = ".json.ls" === filename.substr(-8) ? "module.exports = " + LiveScript.compile(file, {
            filename,
            json: true
          }) : LiveScript.compile(file, {
            filename,
            bare: true,
            map: "embedded"
          }).code;
          try {
            return module2._compile(js, filename);
          } catch (e$) {
            e = e$;
            throw hackTrace(e, js, filename);
          }
        };
      };
      function hackTrace(error, js, filename) {
        var stack, traces, i$, len$, i, trace, index, lno, end, length, lines, j$, ref$, n;
        if (error != null) {
          stack = error.stack;
        }
        if (!stack) {
          return error;
        }
        traces = stack.split("\n");
        if (!(traces.length > 1)) {
          return error;
        }
        for (i$ = 0, len$ = traces.length; i$ < len$; ++i$) {
          i = i$;
          trace = traces[i$];
          if (0 > (index = trace.indexOf("(" + filename + ":"))) {
            continue;
          }
          lno = (/:(\d+):/.exec(trace.slice(index + filename.length)) || "")[1];
          if (!(lno = +lno)) {
            continue;
          }
          end = lno + 4;
          length = ("" + end).length;
          lines || (lines = js.split("\n"));
          for (j$ = 1 > (ref$ = lno - 4) ? 1 : ref$; j$ <= end; ++j$) {
            n = j$;
            traces[i] += "\n" + ("    " + n).slice(-length) + "|+".charAt(n === lno) + " " + [lines[n - 1]];
          }
        }
        return error.stack = traces.join("\n"), error;
      }
      function import$(obj, src) {
        var own = {}.hasOwnProperty;
        for (var key in src) if (own.call(src, key)) obj[key] = src[key];
        return obj;
      }
      function importAll$(obj, src) {
        for (var key in src) obj[key] = src[key];
        return obj;
      }
    }
  });

  // lib/index.js
  var require_index = __commonJS({
    "lib/index.js"(exports) {
      init_shim_buffer();
      var lexer;
      var parser;
      var ast;
      var SourceNode;
      var path;
      var bufferFrom;
      var toString$ = {}.toString;
      lexer = require_lexer();
      parser = require_parser().parser;
      ast = require_ast();
      SourceNode = require_source_map().SourceNode;
      path = require_stub_path();
      parser.yy = ast;
      parser.lexer = {
        lex: function() {
          var ref$, tag, first_line, first_column, last_line, last_column;
          ref$ = this.tokens[++this.pos] || [""], tag = ref$[0], this.yytext = ref$[1], first_line = ref$[2], first_column = ref$[3];
          ref$ = this.tokens[this.pos + 1] || [""], last_line = ref$[2], last_column = ref$[3];
          this.yylineno = first_line;
          this.yylloc = {
            first_line,
            first_column,
            last_line,
            last_column
          };
          return tag;
        },
        setInput: function(it) {
          this.pos = -1;
          return this.tokens = it;
        },
        upcomingInput: function() {
          return "";
        }
      };
      bufferFrom = Buffer2.alloc && Buffer2.from || function(it) {
        return new Buffer2(it);
      };
      exports.VERSION = "1.6.0";
      exports.compile = function(code, options) {
        var result, ast2, output, filename, outputFilename, ref$, mapPath, e, that;
        options == null && (options = {});
        options.warn == null && (options.warn = true);
        options.header == null && (options.header = true);
        if (options.header === true) {
          options.header = "// Generated by LiveScript " + exports.VERSION + "\n";
        }
        try {
          if (options.json) {
            result = Function(exports.compile(code, {
              bare: true,
              run: true,
              print: true
            }))();
            return JSON.stringify(result, null, 2) + "\n";
          } else {
            ast2 = parser.parse(lexer.lex(code));
            if (options.run && options.print) {
              ast2.makeReturn();
            }
            output = ast2.compileRoot(options);
            if (options.map && options.map !== "none") {
              filename = options.filename, outputFilename = options.outputFilename;
              if (!filename) {
                filename = "unnamed-" + Math.floor(Math.random() * 4294967296).toString(16) + ".ls";
              }
              output.setFile(path.basename(filename));
              result = output.toStringWithSourceMap();
              if (options.map === "embedded") {
                result.map.setSourceContent(filename, code);
              }
              if ((ref$ = options.map) === "linked" || ref$ === "debug") {
                mapPath = path.basename(outputFilename) + ".map";
                result.code += "\n//# sourceMappingURL=" + mapPath + "\n";
              } else {
                result.code += "\n//# sourceMappingURL=data:application/json;base64," + bufferFrom(result.map.toString()).toString("base64") + "\n";
              }
              return result;
            } else {
              return output.toString();
            }
          }
        } catch (e$) {
          e = e$;
          if (that = options.filename) {
            e.message += "\nat " + that;
          }
          throw e;
        }
      };
      exports.ast = function(it) {
        return parser.parse(typeof it === "string" ? lexer.lex(it) : it);
      };
      exports.tokens = lexer.lex;
      exports.lex = function(it) {
        return lexer.lex(it, {
          raw: true
        });
      };
      exports.run = function(code, options) {
        var output, ref$;
        output = exports.compile(code, (ref$ = {}, import$(ref$, options), ref$.bare = true, ref$));
        return Function(toString$.call(output).slice(8, -1) === "String" ? output : output.code)();
      };
      exports.tokens.rewrite = lexer.rewrite;
      importAll$(exports.ast, parser.yy);
      if (__require.extensions) {
        require_node()(exports);
      } else {
        exports.require = __require;
      }
      function import$(obj, src) {
        var own = {}.hasOwnProperty;
        for (var key in src) if (own.call(src, key)) obj[key] = src[key];
        return obj;
      }
      function importAll$(obj, src) {
        for (var key in src) obj[key] = src[key];
        return obj;
      }
    }
  });
  return require_index();
})();
