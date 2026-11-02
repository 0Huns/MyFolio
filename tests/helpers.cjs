// Loads the split utility modules and the HTTP client as one object, for tests that mock them together.
exports.loadUtils = loadWith => {
  const errors = loadWith('src/utils/errors.ts', {});
  const parse = loadWith('src/utils/parse.ts', {});
  const time = loadWith('src/utils/time.ts', {});
  const id = loadWith('src/utils/id.ts', {});
  const format = loadWith('src/utils/format.ts', { './time': time });
  const http = loadWith('src/api/http.ts', { '../utils/errors': errors, '../utils/parse': parse });
  return { ...errors, ...parse, ...time, ...id, ...format, ...http };
};
