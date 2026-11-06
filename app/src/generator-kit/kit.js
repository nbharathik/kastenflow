// The drawing kit of a code picture: small helpers that make SVG text, so a program can draw a chart,
// a diagram or an illustration in a few lines and use the deck's own colours. Everything here is a
// pure function over strings and numbers (no page, no network, no files). It runs in the sandboxed
// frame of the runner, which hands the program one kit per run.
(function (global) {
  "use strict";

  var DEFAULTS = {
    text1: "#202124",
    text2: "#5f6368",
    bg1: "#ffffff",
    bg2: "#f1f3f4",
    accent1: "#2563eb",
    accent2: "#16a34a",
    accent3: "#d97706",
    accent4: "#dc2626",
    accent5: "#7c3aed",
    accent6: "#0891b2",
  };

  // Simple icons on a 24 by 24 grid, drawn as outlines.
  var ICONS = {
    check: "M4 12l5 5L20 6",
    cross: "M5 5l14 14M19 5L5 19",
    plus: "M12 4v16M4 12h16",
    star: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z",
    heart: "M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z",
    bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
    circle: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z",
    square: "M4 4h16v16H4z",
    triangle: "M12 3l10 18H2z",
    arrow: "M4 12h14M13 6l6 6-6 6",
    cloud: "M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 10a4 4 0 0 1 0 8z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0z",
  };

  function esc(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // SVG attributes that are written in camel case; every other camel-case name is written with dashes
  // (fontSize is font-size).
  var CAMEL = {
    viewBox: 1,
    preserveAspectRatio: 1,
    gradientUnits: 1,
    gradientTransform: 1,
    patternUnits: 1,
    patternTransform: 1,
    markerWidth: 1,
    markerHeight: 1,
    markerUnits: 1,
    refX: 1,
    refY: 1,
    startOffset: 1,
    textLength: 1,
    stdDeviation: 1,
  };

  function dash(name) {
    if (CAMEL[name]) return name;
    return name.replace(/[A-Z]/g, function (c) {
      return "-" + c.toLowerCase();
    });
  }

  function num(value, what) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw new Error((what || "A value") + " must be a number, not " + String(value));
    }
    return value;
  }

  function merge(base, extra) {
    var out = {};
    Object.keys(base).forEach(function (key) {
      out[key] = base[key];
    });
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        out[key] = extra[key];
      });
    }
    return out;
  }

  function attrs(map) {
    var out = "";
    if (!map) return out;
    Object.keys(map).forEach(function (key) {
      var value = map[key];
      if (value === null || value === undefined || value === false) return;
      if (typeof value === "number" && !isFinite(value)) throw new Error("The attribute " + key + " is not a number");
      out += " " + dash(key) + '="' + esc(value === true ? key : value) + '"';
    });
    return out;
  }

  // Text, or a list of texts (lists may hold lists), joined as they stand.
  function body(inner) {
    if (Array.isArray(inner)) return inner.map(body).join("");
    return inner === undefined || inner === null ? "" : String(inner);
  }

  function el(name, map, inner) {
    if (inner === undefined) return "<" + name + attrs(map) + "/>";
    return "<" + name + attrs(map) + ">" + body(inner) + "</" + name + ">";
  }

  function trimNumber(value) {
    return String(Math.round(value * 10) / 10);
  }

  // Rows of a delimited text, with quotes: a comma, or a tab when the first line has one and no comma.
  function parseRows(text) {
    var first = text.split(/\r?\n/)[0] || "";
    var delimiter = first.indexOf("\t") >= 0 && first.indexOf(",") < 0 ? "\t" : ",";
    var rows = [];
    var row = [];
    var cell = "";
    var quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (quoted) {
        if (c === '"' && text.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else if (c === '"') {
          quoted = false;
        } else {
          cell += c;
        }
      } else if (c === '"') {
        quoted = true;
      } else if (c === delimiter) {
        row.push(cell);
        cell = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }
    if (cell !== "" || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function createKit(given) {
    var theme = {};
    Object.keys(DEFAULTS).forEach(function (token) {
      theme[token] = given && typeof given[token] === "string" ? given[token] : DEFAULTS[token];
    });
    var kit = { version: 1, theme: theme, warnings: [] };

    kit.warn = function (message) {
      if (kit.warnings.length < 20) kit.warnings.push(String(message).slice(0, 300));
    };
    kit.esc = esc;
    kit.el = el;

    // The picture: `body` is text or a list of texts. A background is the deck's, or the colour given.
    kit.svg = function (width, height, inner, options) {
      num(width, "The width");
      num(height, "The height");
      var o = merge(
        {
          xmlns: "http://www.w3.org/2000/svg",
          width: width,
          height: height,
          viewBox: "0 0 " + width + " " + height,
          fontFamily: "Inter, Segoe UI, Arial, sans-serif",
        },
        options,
      );
      var ground = "";
      if (o.background) ground = el("rect", { width: width, height: height, fill: o.background === true ? theme.bg1 : o.background });
      delete o.background;
      return el("svg", o, ground + body(inner));
    };

    kit.g = function (inner, options) {
      return el("g", options, inner === undefined ? [] : inner);
    };

    kit.rect = function (x, y, w, h, options) {
      return el("rect", merge({ x: num(x, "x"), y: num(y, "y"), width: num(w, "width"), height: num(h, "height"), fill: theme.accent1 }, options));
    };

    kit.circle = function (cx, cy, r, options) {
      return el("circle", merge({ cx: num(cx, "cx"), cy: num(cy, "cy"), r: num(r, "r"), fill: theme.accent1 }, options));
    };

    kit.ellipse = function (cx, cy, rx, ry, options) {
      return el("ellipse", merge({ cx: num(cx, "cx"), cy: num(cy, "cy"), rx: num(rx, "rx"), ry: num(ry, "ry"), fill: theme.accent1 }, options));
    };

    kit.line = function (x1, y1, x2, y2, options) {
      return el("line", merge({ x1: num(x1, "x1"), y1: num(y1, "y1"), x2: num(x2, "x2"), y2: num(y2, "y2"), stroke: theme.text2 }, options));
    };

    function pointList(points) {
      return points
        .map(function (p) {
          return num(p[0], "A point's x") + "," + num(p[1], "A point's y");
        })
        .join(" ");
    }

    kit.polygon = function (points, options) {
      return el("polygon", merge({ points: pointList(points), fill: theme.accent1 }, options));
    };

    kit.polyline = function (points, options) {
      return el("polyline", merge({ points: pointList(points), fill: "none", stroke: theme.accent1, strokeWidth: 2 }, options));
    };

    kit.path = function (d, options) {
      return el("path", merge({ d: String(d), fill: "none", stroke: theme.accent1, strokeWidth: 2 }, options));
    };

    // Words at a point. `anchor` (start, middle, end), `size`, `weight` and `fill` are the usual options.
    kit.text = function (x, y, words, options) {
      var o = merge({ x: num(x, "x"), y: num(y, "y"), fill: theme.text1, fontSize: 16 }, options);
      if (o.anchor) o.textAnchor = o.anchor;
      if (o.size) o.fontSize = o.size;
      if (o.weight) o.fontWeight = o.weight;
      delete o.anchor;
      delete o.size;
      delete o.weight;
      return el("text", o, esc(words));
    };

    // Words broken into lines of at most `max` characters.
    kit.wrap = function (words, max) {
      var lines = [];
      var line = "";
      String(words)
        .split(/\s+/)
        .forEach(function (word) {
          if (word === "") return;
          if (line !== "" && (line + " " + word).length > max) {
            lines.push(line);
            line = word;
          } else {
            line = line === "" ? word : line + " " + word;
          }
        });
      if (line !== "") lines.push(line);
      return lines;
    };

    kit.icon = function (name, x, y, size, options) {
      var d = ICONS[name];
      if (!d) throw new Error('There is no icon "' + name + '". The icons are: ' + Object.keys(ICONS).join(", "));
      var scale = num(size, "The size") / 24;
      return el(
        "path",
        merge(
          {
            d: d,
            transform: "translate(" + num(x, "x") + " " + num(y, "y") + ") scale(" + scale + ")",
            fill: "none",
            stroke: theme.accent1,
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
          options,
        ),
      );
    };
    kit.icons = Object.keys(ICONS);

    // Nice round numbers between min and max, about n of them.
    kit.ticks = function (min, max, n) {
      var count = n || 5;
      var lo = Math.min(num(min, "min"), num(max, "max"));
      var hi = Math.max(min, max);
      if (hi === lo) return [lo];
      var step0 = (hi - lo) / count;
      var base = Math.pow(10, Math.floor(Math.log(step0) / Math.LN10));
      var error = step0 / base;
      var step = base;
      if (error >= Math.sqrt(50)) step = 10 * base;
      else if (error >= Math.sqrt(10)) step = 5 * base;
      else if (error >= Math.sqrt(2)) step = 2 * base;
      var out = [];
      for (var i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) out.push(Number((i * step).toPrecision(12)));
      return out;
    };

    kit.scaleLinear = function (domain, range) {
      var d0 = num(domain[0], "The domain");
      var d1 = num(domain[1], "The domain");
      var r0 = num(range[0], "The range");
      var r1 = num(range[1], "The range");
      var scale = function (value) {
        return d1 === d0 ? r0 : r0 + ((num(value, "A value") - d0) / (d1 - d0)) * (r1 - r0);
      };
      scale.domain = [d0, d1];
      scale.range = [r0, r1];
      scale.ticks = function (n) {
        return kit.ticks(d0, d1, n);
      };
      scale.invert = function (position) {
        return r1 === r0 ? d0 : d0 + ((position - r0) / (r1 - r0)) * (d1 - d0);
      };
      return scale;
    };

    // One band for each label; `padding` is the share of a step left empty (0.2 by default).
    kit.scaleBand = function (labels, range, padding) {
      var p = padding === undefined ? 0.2 : padding;
      var r0 = num(range[0], "The range");
      var r1 = num(range[1], "The range");
      var step = labels.length ? (r1 - r0) / labels.length : 0;
      var scale = function (label) {
        var at = labels.indexOf(label);
        if (at < 0) throw new Error('There is no band for "' + label + '"');
        return r0 + at * step + (step * p) / 2;
      };
      scale.labels = labels;
      scale.range = [r0, r1];
      scale.step = function () {
        return step;
      };
      scale.bandwidth = function () {
        return step * (1 - p);
      };
      scale.center = function (label) {
        return scale(label) + scale.bandwidth() / 2;
      };
      return scale;
    };

    function marks(scale, options) {
      var o = merge({ ticks: 5, size: 14, color: theme.text2, format: kit.format }, options);
      if (scale.bandwidth) {
        return {
          o: o,
          at: scale.labels.map(function (label) {
            return { position: scale.center(label), text: String(label) };
          }),
        };
      }
      return {
        o: o,
        at: scale.ticks(o.ticks).map(function (value) {
          return { position: scale(value), text: o.format(value) };
        }),
      };
    }

    // The bottom axis at height y.
    kit.axisBottom = function (scale, y, options) {
      var m = marks(scale, options);
      var parts = [kit.line(scale.range[0], y, scale.range[1], y, { stroke: m.o.color })];
      m.at.forEach(function (mark) {
        parts.push(kit.line(mark.position, y, mark.position, y + 6, { stroke: m.o.color }));
        parts.push(kit.text(mark.position, y + 8 + m.o.size, mark.text, { anchor: "middle", size: m.o.size, fill: m.o.color }));
      });
      return kit.g(parts);
    };

    // The left axis at x.
    kit.axisLeft = function (scale, x, options) {
      var m = marks(scale, options);
      var parts = [kit.line(x, scale.range[0], x, scale.range[1], { stroke: m.o.color })];
      m.at.forEach(function (mark) {
        parts.push(kit.line(x - 6, mark.position, x, mark.position, { stroke: m.o.color }));
        parts.push(kit.text(x - 10, mark.position + m.o.size / 3, mark.text, { anchor: "end", size: m.o.size, fill: m.o.color }));
      });
      return kit.g(parts);
    };

    // The rows of a CSV (or tab-separated) text as objects named by its first line; numbers become numbers.
    kit.csv = function (text) {
      var rows = parseRows(String(text));
      if (rows.length === 0) return [];
      var head = rows[0].map(function (name) {
        return name.trim();
      });
      return rows
        .slice(1)
        .filter(function (row) {
          return row.length > 1 || (row.length === 1 && row[0].trim() !== "");
        })
        .map(function (row) {
          var out = {};
          head.forEach(function (name, i) {
            var cell = row[i] === undefined ? "" : row[i];
            var t = cell.trim();
            out[name] = t !== "" && isFinite(Number(t)) ? Number(t) : cell;
          });
          return out;
        });
    };

    kit.json = function (text) {
      try {
        return JSON.parse(String(text));
      } catch (e) {
        throw new Error("The input is not JSON: " + e.message);
      }
    };

    // A colour of the deck's accents, round and round.
    kit.palette = function (i) {
      var n = ((Math.floor(num(i, "The index")) % 6) + 6) % 6;
      return theme["accent" + (n + 1)];
    };

    // 1234 is 1.2k, 1500000 is 1.5M; small numbers stay as they are.
    kit.format = function (value) {
      if (typeof value !== "number" || !isFinite(value)) return String(value);
      var a = Math.abs(value);
      if (a >= 1e9) return trimNumber(value / 1e9) + "B";
      if (a >= 1e6) return trimNumber(value / 1e6) + "M";
      if (a >= 1e3) return trimNumber(value / 1e3) + "k";
      return String(Math.round(value * 100) / 100);
    };

    return kit;
  }

  global.createKit = createKit;
})(window);
