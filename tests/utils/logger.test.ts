import { describe, it, expect } from 'vitest';
import { formatLogMessage } from '../../src/utils/logger';

describe('Logging Helpers', () => {
    it('formats a basic message correctly', () => {
        const result = formatLogMessage('info', 'Hello world');
        expect(result).toBe('[INFO] Hello world');
    });

    it('formats a message with metadata correctly', () => {
        const result = formatLogMessage('error', 'Something failed', { code: 500 });
        expect(result).toBe('[ERROR] Something failed {"code":500}');
    });

    it('handles uppercase levels correctly', () => {
        const result = formatLogMessage('WARN', 'Watch out');
        expect(result).toBe('[WARN] Watch out');
    });

    it('handles empty message correctly', () => {
        const result = formatLogMessage('debug', '');
        expect(result).toBe('[DEBUG] ');
    });

    it('handles empty metadata correctly', () => {
        const result = formatLogMessage('info', 'Test', {});
        expect(result).toBe('[INFO] Test {}');
    });

    it('handles missing metadata explicitly undefined', () => {
        const result = formatLogMessage('info', 'Test', undefined);
        expect(result).toBe('[INFO] Test');
    });

    it('handles metadata with different data types', () => {
        const result = formatLogMessage('debug', 'Mixed meta', { num: 123, bool: true, str: 'text', nullVal: null });
        expect(result).toBe('[DEBUG] Mixed meta {"num":123,"bool":true,"str":"text","nullVal":null}');
    });

    it('handles nested objects in metadata', () => {
        const result = formatLogMessage('warn', 'Nested meta', { user: { id: 1, role: 'admin' } });
        expect(result).toBe('[WARN] Nested meta {"user":{"id":1,"role":"admin"}}');
    });

    it('handles arrays in metadata', () => {
        const result = formatLogMessage('info', 'Array meta', { tags: ['a', 'b', 'c'] });
        expect(result).toBe('[INFO] Array meta {"tags":["a","b","c"]}');
    });

    it('handles undefined properties in metadata', () => {
        const result = formatLogMessage('info', 'Undefined property', { prop1: 'value', prop2: undefined });
        expect(result).toBe('[INFO] Undefined property {"prop1":"value"}');
    });

    it('handles mixed case log levels', () => {
        const result = formatLogMessage('InFo', 'Mixed case', { data: 1 });
        expect(result).toBe('[INFO] Mixed case {"data":1}');
    });

    it('handles Object.create(null) metadata', () => {
        const meta = Object.create(null);
        meta.key = 'value';
        const result = formatLogMessage('info', 'Null prototype object', meta);
        expect(result).toBe('[INFO] Null prototype object {"key":"value"}');
    });

    it('handles functions in metadata (stringifies to undefined/omitted)', () => {
        const result = formatLogMessage('info', 'Function meta', { fn: () => {} });
        expect(result).toBe('[INFO] Function meta {}');
    });

    it('handles a message passed as a number (coercion behavior)', () => {
        // @ts-ignore: Intentionally testing JS behavior when non-strings are passed
        const result = formatLogMessage('warn', 404, { url: '/not-found' });
        expect(result).toBe('[WARN] 404 {"url":"/not-found"}');
    });

    it('handles Symbol in metadata (stringifies to undefined/omitted)', () => {
        const sym = Symbol('test');
        const result = formatLogMessage('debug', 'Symbol meta', { id: sym });
        expect(result).toBe('[DEBUG] Symbol meta {}');
    });

    it('handles circular references in metadata (should throw or fail if JSON.stringify throws)', () => {
        const circularMeta: any = { a: 1 };
        circularMeta.self = circularMeta;
        // JSON.stringify will throw TypeError: Converting circular structure to JSON
        expect(() => formatLogMessage('error', 'Circular', circularMeta)).toThrow();
    });

    it('handles BigInt in metadata (JSON.stringify throws unless replacer is used)', () => {
        // By default JSON.stringify throws on BigInt
        expect(() => formatLogMessage('info', 'BigInt meta', { val: 123n })).toThrow();
    });

    it('handles extremely long message string', () => {
        const longMsg = 'x'.repeat(10000);
        const result = formatLogMessage('info', longMsg);
        expect(result).toBe(`[INFO] ${longMsg}`);
    });

    it('handles null explicitly passed as metadata', () => {
        const result = formatLogMessage('info', 'Null meta', null as any);
        expect(result).toBe('[INFO] Null meta');
    });

    it('handles empty string log level', () => {
        const result = formatLogMessage('', 'Empty level');
        expect(result).toBe('[] Empty level');
    });

    it('handles multiline messages', () => {
        const result = formatLogMessage('error', 'Line 1\nLine 2\nLine 3');
        expect(result).toBe('[ERROR] Line 1\nLine 2\nLine 3');
    });

    it('handles log levels with leading and trailing whitespace', () => {
        const result = formatLogMessage('  info  ', 'Message');
        expect(result).toBe('[  INFO  ] Message');
    });

    it('handles JSON string within the message', () => {
        const result = formatLogMessage('debug', 'Payload: {"key": "value"}');
        expect(result).toBe('[DEBUG] Payload: {"key": "value"}');
    });

    it('handles metadata with keys containing special characters and spaces', () => {
        const result = formatLogMessage('warn', 'Special keys', { 'key with spaces': 1, '@special!': 'value' });
        expect(result).toBe('[WARN] Special keys {"key with spaces":1,"@special!":"value"}');
    });

    it('handles deeply nested complex metadata structures', () => {
        const complexMeta = {
            level1: {
                level2: {
                    level3: {
                        arr: [1, 2, { deepKey: 'deepValue' }]
                    }
                }
            }
        };
        const result = formatLogMessage('info', 'Deep nest', complexMeta);
        expect(result).toBe('[INFO] Deep nest {"level1":{"level2":{"level3":{"arr":[1,2,{"deepKey":"deepValue"}]}}}}');
    });

    it('handles empty message with metadata', () => {
        const result = formatLogMessage('info', '', { test: 123 });
        expect(result).toBe('[INFO]  {"test":123}');
    });

    it('handles custom object toString behavior in metadata', () => {
        const meta = {
            toString() { return 'custom-string'; },
            val: 1
        };
        const result = formatLogMessage('info', 'Custom toString', meta);
        expect(result).toBe('[INFO] Custom toString {"val":1}');
    });

    it('handles object with toJSON defined in metadata', () => {
        const meta = {
            toJSON() { return { custom: 'json-val' }; }
        };
        const result = formatLogMessage('debug', 'toJSON custom', meta);
        expect(result).toBe('[DEBUG] toJSON custom {"custom":"json-val"}');
    });

    it('handles undefined metadata when level is missing', () => {
        const result = formatLogMessage('', 'Missing level', undefined);
        expect(result).toBe('[] Missing level');
    });

    it('handles boolean message content (coercion behavior)', () => {
        // @ts-ignore: Intentionally testing JS behavior when non-strings are passed
        const result = formatLogMessage('info', true);
        expect(result).toBe('[INFO] true');
    });

    it('handles Array metadata with complex nested objects', () => {
        const complexArray = [
            { id: 1, nested: { prop: 'val1' } },
            { id: 2, arr: [3, 4] },
            null,
            "string"
        ];
        const result = formatLogMessage('debug', 'Complex Array', { data: complexArray });
        expect(result).toBe('[DEBUG] Complex Array {"data":[{"id":1,"nested":{"prop":"val1"}},{"id":2,"arr":[3,4]},null,"string"]}');
    });

    it('handles metadata with multiple boolean properties', () => {
        const result = formatLogMessage('info', 'Booleans', { a: true, b: false, c: true });
        expect(result).toBe('[INFO] Booleans {"a":true,"b":false,"c":true}');
    });

    it('handles metadata with multiple null properties', () => {
        const result = formatLogMessage('warn', 'Nulls', { a: null, b: null, c: null });
        expect(result).toBe('[WARN] Nulls {"a":null,"b":null,"c":null}');
    });

    it('handles metadata containing empty string value', () => {
        const result = formatLogMessage('debug', 'Empty string value', { emptyStr: '' });
        expect(result).toBe('[DEBUG] Empty string value {"emptyStr":""}');
    });

    it('handles numeric message correctly when passed as string', () => {
        const result = formatLogMessage('info', '12345');
        expect(result).toBe('[INFO] 12345');
    });

    it('handles floating point values in metadata', () => {
        const result = formatLogMessage('debug', 'Float meta', { floatVal: 123.456 });
        expect(result).toBe('[DEBUG] Float meta {"floatVal":123.456}');
    });

    it('handles scientific notation numbers in metadata', () => {
        const result = formatLogMessage('info', 'Scientific meta', { sciVal: 1.2e-4 });
        expect(result).toBe('[INFO] Scientific meta {"sciVal":0.00012}');
    });

    it('handles negative numbers in metadata', () => {
        const result = formatLogMessage('warn', 'Negative meta', { negVal: -999 });
        expect(result).toBe('[WARN] Negative meta {"negVal":-999}');
    });

    it('handles extremely small decimal numbers in metadata', () => {
        const result = formatLogMessage('debug', 'Small float', { smallVal: 0.0000000001 });
        expect(result).toBe('[DEBUG] Small float {"smallVal":1e-10}');
    });

    it('handles Map objects in metadata (stringifies to empty object)', () => {
        const result = formatLogMessage('info', 'Map meta', { map: new Map([['key', 'value']]) });
        expect(result).toBe('[INFO] Map meta {"map":{}}');
    });

    it('handles Set objects in metadata (stringifies to empty object)', () => {
        const result = formatLogMessage('info', 'Set meta', { set: new Set(['value']) });
        expect(result).toBe('[INFO] Set meta {"set":{}}');
    });

    it('handles RegExp objects in metadata (stringifies to empty object)', () => {
        const result = formatLogMessage('info', 'RegExp meta', { regex: /test/ });
        expect(result).toBe('[INFO] RegExp meta {"regex":{}}');
    });

    it('handles Error objects in metadata (stringifies to empty object unless custom enumerable properties exist)', () => {
        const result = formatLogMessage('error', 'Error meta', { err: new Error('test') });
        expect(result).toBe('[ERROR] Error meta {"err":{}}');
    });

    it('handles NaN in metadata (stringifies to null)', () => {
        const result = formatLogMessage('warn', 'NaN meta', { val: NaN });
        expect(result).toBe('[WARN] NaN meta {"val":null}');
    });

    it('handles Infinity and -Infinity in metadata (stringifies to null)', () => {
        const result = formatLogMessage('warn', 'Infinity meta', { inf: Infinity, negInf: -Infinity });
        expect(result).toBe('[WARN] Infinity meta {"inf":null,"negInf":null}');
    });

    it('handles Date objects in metadata (stringifies to ISO string)', () => {
        const date = new Date('2023-01-01T00:00:00.000Z');
        const result = formatLogMessage('info', 'Date meta', { date });
        expect(result).toBe('[INFO] Date meta {"date":"2023-01-01T00:00:00.000Z"}');
    });

    it('handles arrays of empty objects in metadata', () => {
        const result = formatLogMessage('info', 'Empty objects array', { arr: [{}, {}] });
        expect(result).toBe('[INFO] Empty objects array {"arr":[{},{}]}');
    });

    it('handles nested arrays in metadata', () => {
        const result = formatLogMessage('info', 'Nested arrays', { arr: [[1, 2], [3, 4]] });
        expect(result).toBe('[INFO] Nested arrays {"arr":[[1,2],[3,4]]}');
    });

    it('handles null values inside arrays in metadata', () => {
        const result = formatLogMessage('info', 'Nulls in array', { arr: [1, null, 3] });
        expect(result).toBe('[INFO] Nulls in array {"arr":[1,null,3]}');
    });

    it('handles symbol object properties in metadata', () => {
        const sym = Symbol('foo');
        const meta = { [sym]: 'value', normalKey: 'normalVal' };
        const result = formatLogMessage('info', 'Symbols in object', meta);
        // Symbols are ignored in JSON stringify
        expect(result).toBe('[INFO] Symbols in object {"normalKey":"normalVal"}');
    });

    it('handles Error objects directly as message (coercion)', () => {
        const err = new Error('Test error');
        // @ts-ignore
        const result = formatLogMessage('error', err);
        expect(result).toMatch(/\[ERROR\] Error: Test error/);
    });

    it('throws TypeError for undefined log level (manual coercion)', () => {
        // @ts-ignore
        expect(() => formatLogMessage(undefined, 'Missing level')).toThrow(TypeError);
    });

    it('handles empty message and undefined metadata', () => {
        const result = formatLogMessage('info', '');
        expect(result).toBe('[INFO] ');
    });

    it('handles null level explicitly passed', () => {
        // @ts-ignore
        const result = formatLogMessage(null, 'Null level test');
        expect(result).toBe('[NULL] Null level test');
    });

    it('handles boolean log level explicitly passed', () => {
        // @ts-ignore
        const result = formatLogMessage(true, 'Boolean level test');
        expect(result).toBe('[TRUE] Boolean level test');
    });

    it('handles numeric log level explicitly passed', () => {
        // @ts-ignore
        const result = formatLogMessage(123, 'Numeric level test');
        expect(result).toBe('[123] Numeric level test');
    });

    it('handles undefined message explicitly passed', () => {
        // @ts-ignore
        const result = formatLogMessage('info', undefined);
        expect(result).toBe('[INFO] undefined');
    });

    it('handles function message explicitly passed', () => {
        // @ts-ignore
        const result = formatLogMessage('info', function() {});
        expect(result).toMatch(/\[INFO\] function/);
    });

    it('handles empty string metadata correctly', () => {
        const result = formatLogMessage('info', 'Test', { empty: '' });
        expect(result).toBe('[INFO] Test {"empty":""}');
    });

    it('handles metadata with nested arrays', () => {
        const result = formatLogMessage('info', 'Test', { arr: [[1, 2], [3, 4]] });
        expect(result).toBe('[INFO] Test {"arr":[[1,2],[3,4]]}');
    });

    it('handles metadata with boolean values', () => {
        const result = formatLogMessage('info', 'Test', { flag: true, active: false });
        expect(result).toBe('[INFO] Test {"flag":true,"active":false}');
    });

    it('handles numeric levels correctly', () => {
        // @ts-ignore
        const result = formatLogMessage(123, 'Test');
        expect(result).toBe('[123] Test');
    });

    it('handles null level correctly', () => {
        // @ts-ignore
        const result = formatLogMessage(null, 'Test');
        expect(result).toBe('[NULL] Test');
    });

    it('handles metadata with multiple nested objects', () => {
        const result = formatLogMessage('info', 'Nested', { a: { b: { c: 1 } } });
        expect(result).toBe('[INFO] Nested {"a":{"b":{"c":1}}}');
    });

    it('handles message with special characters', () => {
        const result = formatLogMessage('info', 'Test !@#$%^&*()_+');
        expect(result).toBe('[INFO] Test !@#$%^&*()_+');
    });

    it('handles message with newline characters', () => {
        const result = formatLogMessage('info', 'Test\nLine 2');
        expect(result).toBe('[INFO] Test\nLine 2');
    });

    it('handles message with very long text', () => {
        const longText = 'a'.repeat(1000);
        const result = formatLogMessage('info', longText);
        expect(result).toBe(`[INFO] ${longText}`);
    });

    it('handles message with carriage returns', () => {
        const result = formatLogMessage('info', 'Test\r\nLine 2');
        expect(result).toBe('[INFO] Test\r\nLine 2');
    });

    it('handles metadata with boolean values', () => {
        const result = formatLogMessage('debug', 'Test', { flag: true, anotherFlag: false });
        expect(result).toBe('[DEBUG] Test {"flag":true,"anotherFlag":false}');
    });


    it('handles metadata with null values batch 3 part 15', () => {
        const result = formatLogMessage('debug', 'Test', { val: null });
        expect(result).toBe('[DEBUG] Test {"val":null}');
    });


    it('handles metadata with empty object batch 3 part 15', () => {
        const result = formatLogMessage('debug', 'Test', {});
        expect(result).toBe('[DEBUG] Test {}');
    });

    it('handles metadata with nested arrays batch 3 part 15', () => {
        const result = formatLogMessage('info', 'Test', { arr: [1, 2, [3, 4]] });
        expect(result).toBe('[INFO] Test {"arr":[1,2,[3,4]]}');
    });


    // --- Added for Batch 4 Part 15 ---

    it('handles metadata with mixed array elements batch 4 part 15', () => {
        const result = formatLogMessage('info', 'Test', { mixed: [1, "two", { three: 3 }, null, [5]] });
        expect(result).toBe('[INFO] Test {"mixed":[1,"two",{"three":3},null,[5]]}');
    });

    it('handles false boolean value alone in metadata batch 4 part 15', () => {
        const result = formatLogMessage('debug', 'Test', { isFalse: false });
        expect(result).toBe('[DEBUG] Test {"isFalse":false}');
    });

    it('handles numeric 0 alone in metadata batch 4 part 15', () => {
        const result = formatLogMessage('debug', 'Test', { isZero: 0 });
        expect(result).toBe('[DEBUG] Test {"isZero":0}');
    });

    it('handles undefined value in metadata batch 4 part 15', () => {
        // undefined values are omitted by JSON.stringify
        const result = formatLogMessage('debug', 'Test', { isUndefined: undefined });
        expect(result).toBe('[DEBUG] Test {}');
    });



    // --- Added for Batch 1 Part 16 ---

    it('handles metadata with deeply nested boolean arrays batch 1 part 16', () => {
        const result = formatLogMessage('debug', 'Test', { nestedBools: [[[true, false]]] });
        expect(result).toBe('[DEBUG] Test {"nestedBools":[[[true,false]]]}');
    });

    it('handles symbol values inside arrays batch 1 part 16', () => {
        const sym = Symbol('test');
        // Symbols in arrays become null in JSON.stringify
        const result = formatLogMessage('info', 'Test', { arrWithSym: [1, sym, 3] });
        expect(result).toBe('[INFO] Test {"arrWithSym":[1,null,3]}');
    });


    // --- Added for Batch 2 Part 16 ---

    it('handles metadata with deeply nested string arrays batch 2 part 16', () => {
        const result = formatLogMessage('debug', 'Test', { nestedStrings: [[['a', 'b']]] });
        expect(result).toBe('[DEBUG] Test {"nestedStrings":[[["a","b"]]]}');
    });

    it('handles boolean values inside arrays batch 2 part 16', () => {
        const result = formatLogMessage('info', 'Test', { arrWithBool: [true, false] });
        expect(result).toBe('[INFO] Test {"arrWithBool":[true,false]}');
    });

    // --- Added for Batch 3 Part 16 ---

    it('handles metadata with mixed primitive arrays batch 3 part 16', () => {
        const result = formatLogMessage('debug', 'Test', { mixedArr: [1, "two", false, null] });
        expect(result).toBe('[DEBUG] Test {"mixedArr":[1,"two",false,null]}');
    });

    it('handles empty string metadata value batch 3 part 16', () => {
        const result = formatLogMessage('info', 'Test', { emptyStr: "" });
        expect(result).toBe('[INFO] Test {"emptyStr":""}');
    });


    // --- Added for Batch 0 Part 17 ---
    it('handles metadata with nested mixed primitive arrays batch 0 part 17', () => {
        const result = formatLogMessage('debug', 'Test', { nested: { mixedArr: [1, "two", false, null] } });
        expect(result).toBe('[DEBUG] Test {"nested":{"mixedArr":[1,"two",false,null]}}');
    });

    it('handles metadata with zero batch 0 part 17', () => {
        const result = formatLogMessage('info', 'Test', { zeroVal: 0 });
        expect(result).toBe('[INFO] Test {"zeroVal":0}');
    });
    // --- Added for Batch 1 Part 17 ---
    it('handles negative numbers in metadata batch 1 part 17', () => {
        const result = formatLogMessage('info', 'Test', { count: -5 });
        expect(result).toBe('[INFO] Test {"count":-5}');
    });

    it('handles multiple nested objects batch 1 part 17', () => {
        const result = formatLogMessage('debug', 'Test', { a: { b: { c: 1 } } });
        expect(result).toBe('[DEBUG] Test {"a":{"b":{"c":1}}}');
    });

    it('handles very long string messages batch 1 part 17', () => {
        const longStr = 'a'.repeat(1000);
        const result = formatLogMessage('warn', longStr);
        expect(result).toBe(`[WARN] ${longStr}`);
    });


    // --- Added for Batch 2 Part 17 ---
    it('handles floating point numbers in metadata batch 2 part 17', () => {
        const result = formatLogMessage('info', 'Test', { pi: 3.14159 });
        expect(result).toBe('[INFO] Test {"pi":3.14159}');
    });

    it('handles boolean false as top level metadata batch 2 part 17', () => {
        const result = formatLogMessage('debug', 'Test', { flag: false });
        expect(result).toBe('[DEBUG] Test {"flag":false}');
    });

    it('handles undefined values in objects within arrays batch 2 part 17', () => {
        const result = formatLogMessage('warn', 'Test', { arr: [{ valid: 1, invalid: undefined }] });
        // undefined is omitted from object but keeps object structure
        expect(result).toBe('[WARN] Test {"arr":[{"valid":1}]}');
    });


    // --- Added for Batch 1 Part 18 ---
    it('handles negative integers in metadata batch 1 part 18', () => {
        const result = formatLogMessage('info', 'Negative', { val: -42 });
        expect(result).toBe('[INFO] Negative {"val":-42}');
    });

    it('handles null level by converting it to string batch 1 part 18', () => {
        const result = formatLogMessage(null as unknown as string, 'Null level test');
        expect(result).toBe('[NULL] Null level test');
    });

    it('handles metadata with empty string keys batch 1 part 18', () => {
        const result = formatLogMessage('debug', 'Test', { "": "empty key" });
        expect(result).toBe('[DEBUG] Test {"":"empty key"}');
    });

    it('handles deeply nested arrays in metadata batch 1 part 18', () => {
        const result = formatLogMessage('trace', 'Test', { data: [[[1]]] });
        expect(result).toBe('[TRACE] Test {"data":[[[1]]]}');
    });


    // --- Added for Batch 1 Part 19 ---
    it('handles negative floats in metadata batch 1 part 19', () => {
        const result = formatLogMessage('info', 'Negative Float', { val: -42.5 });
        expect(result).toBe('[INFO] Negative Float {"val":-42.5}');
    });

    it('handles arrays with undefined batch 1 part 19', () => {
        const result = formatLogMessage('debug', 'Test Array', { arr: [1, undefined, 3] });
        expect(result).toBe('[DEBUG] Test Array {"arr":[1,null,3]}');
    });

    it('handles metadata with nested empty objects batch 1 part 19', () => {
        const result = formatLogMessage('info', 'Nested Empty', { nested: {} });
        expect(result).toBe('[INFO] Nested Empty {"nested":{}}');
    });

    it('handles metadata with nested empty arrays batch 1 part 19', () => {
        const result = formatLogMessage('trace', 'Nested Empty Array', { data: { arr: [] } });
        expect(result).toBe('[TRACE] Nested Empty Array {"data":{"arr":[]}}');
    });


    it('handles multiple null values in metadata batch 0 part 19', () => {
        const result = formatLogMessage('warn', 'Multiple nulls', { a: null, b: null });
        expect(result).toBe('[WARN] Multiple nulls {"a":null,"b":null}');
    });

    it('handles mixed primitive array in metadata batch 0 part 19', () => {
        const result = formatLogMessage('info', 'Mixed array', { arr: [1, 'two', false, null] });
        expect(result).toBe('[INFO] Mixed array {"arr":[1,"two",false,null]}');
    });

    it('handles string with spaces in metadata batch 0 part 19', () => {
        const result = formatLogMessage('debug', 'String with spaces', { text: "hello world" });
        expect(result).toBe('[DEBUG] String with spaces {"text":"hello world"}');
    });

    it('handles floating point array in metadata batch 0 part 19', () => {
        const result = formatLogMessage('trace', 'Floats array', { arr: [1.1, 2.2, 3.3] });
        expect(result).toBe('[TRACE] Floats array {"arr":[1.1,2.2,3.3]}');
    });

    it('handles empty string key in metadata batch 0 part 19', () => {
        const result = formatLogMessage('error', 'Empty key', { "": "value" });
        expect(result).toBe('[ERROR] Empty key {"":"value"}');
    });


    it('handles deeply nested object metadata batch 1 part 19', () => {
        const result = formatLogMessage('info', 'Deep', { a: { b: { c: { d: 1 } } } });
        expect(result).toBe('[INFO] Deep {"a":{"b":{"c":{"d":1}}}}');
    });

    it('handles special characters in message batch 1 part 19', () => {
        const result = formatLogMessage('warn', 'Special !@#$%^&*()_+', { key: 'val' });
        expect(result).toBe('[WARN] Special !@#$%^&*()_+ {"key":"val"}');
    });

    it('handles zero in metadata batch 1 part 19', () => {
        const result = formatLogMessage('debug', 'Zero', { val: 0 });
        expect(result).toBe('[DEBUG] Zero {"val":0}');
    });

    it('handles empty message with metadata batch 1 part 19', () => {
        const result = formatLogMessage('trace', '', { empty: true });
        expect(result).toBe('[TRACE]  {"empty":true}');
    });


    it('handles negative numbers in metadata batch 2 part 19', () => {
        const result = formatLogMessage('info', 'Negative', { val: -42 });
        expect(result).toBe('[INFO] Negative {"val":-42}');
    });

    it('handles boolean true in metadata batch 2 part 19', () => {
        const result = formatLogMessage('debug', 'Boolean', { isTrue: true });
        expect(result).toBe('[DEBUG] Boolean {"isTrue":true}');
    });

    it('handles boolean false in metadata batch 2 part 19', () => {
        const result = formatLogMessage('debug', 'Boolean', { isFalse: false });
        expect(result).toBe('[DEBUG] Boolean {"isFalse":false}');
    });

    it('handles arrays of strings in metadata batch 2 part 19', () => {
        const result = formatLogMessage('trace', 'String array', { arr: ['a', 'b', 'c'] });
        expect(result).toBe('[TRACE] String array {"arr":["a","b","c"]}');
    });

    it('handles multiple metadata properties batch 2 part 19', () => {
        const result = formatLogMessage('info', 'Multi', { a: 1, b: 2, c: 3 });
        expect(result).toBe('[INFO] Multi {"a":1,"b":2,"c":3}');
    });


    it('handles arrays of numbers in metadata batch 3 part 19', () => {
        const result = formatLogMessage('trace', 'Num array', { arr: [1, 2, 3] });
        expect(result).toBe('[TRACE] Num array {"arr":[1,2,3]}');
    });

    it('handles mixed arrays in metadata batch 3 part 19', () => {
        const result = formatLogMessage('info', 'Mixed array', { arr: [1, 'two', true] });
        expect(result).toBe('[INFO] Mixed array {"arr":[1,"two",true]}');
    });

    it('handles objects within arrays in metadata batch 3 part 19', () => {
        const result = formatLogMessage('warn', 'Obj array', { arr: [{ a: 1 }, { b: 2 }] });
        expect(result).toBe('[WARN] Obj array {"arr":[{"a":1},{"b":2}]}');
    });

    it('handles null values within arrays batch 3 part 19', () => {
        const result = formatLogMessage('debug', 'Null array', { arr: [null, null] });
        expect(result).toBe('[DEBUG] Null array {"arr":[null,null]}');
    });

    it('handles undefined values within arrays batch 3 part 19', () => {
        const result = formatLogMessage('trace', 'Undefined array', { arr: [undefined, undefined] });
        expect(result).toBe('[TRACE] Undefined array {"arr":[null,null]}');
    });


    it('handles nested empty objects in metadata batch 4 part 19', () => {
        const result = formatLogMessage('info', 'Nested empty', { a: {} });
        expect(result).toBe('[INFO] Nested empty {"a":{}}');
    });

    it('handles nested empty arrays in metadata batch 4 part 19', () => {
        const result = formatLogMessage('debug', 'Nested empty array', { a: [] });
        expect(result).toBe('[DEBUG] Nested empty array {"a":[]}');
    });

    it('handles boolean values in deep objects batch 4 part 19', () => {
        const result = formatLogMessage('warn', 'Deep bool', { a: { b: { c: true } } });
        expect(result).toBe('[WARN] Deep bool {"a":{"b":{"c":true}}}');
    });

    it('handles arrays in deep objects batch 4 part 19', () => {
        const result = formatLogMessage('trace', 'Deep array', { a: { b: { c: [1, 2] } } });
        expect(result).toBe('[TRACE] Deep array {"a":{"b":{"c":[1,2]}}}');
    });

    it('handles string numbers in metadata batch 4 part 19', () => {
        const result = formatLogMessage('info', 'String number', { val: "42" });
        expect(result).toBe('[INFO] String number {"val":"42"}');
    });


    it('handles numeric keys in metadata batch 5 part 19', () => {
        const result = formatLogMessage('info', 'Numeric key', { 1: "one" });
        expect(result).toBe('[INFO] Numeric key {"1":"one"}');
    });

    it('handles multiple numeric keys in metadata batch 5 part 19', () => {
        const result = formatLogMessage('debug', 'Numeric keys', { 1: "one", 2: "two" });
        expect(result).toBe('[DEBUG] Numeric keys {"1":"one","2":"two"}');
    });

    it('handles negative numeric keys in metadata batch 5 part 19', () => {
        const result = formatLogMessage('warn', 'Negative key', { "-1": "minus one" });
        expect(result).toBe('[WARN] Negative key {"-1":"minus one"}');
    });

    it('handles object with only empty string key batch 5 part 19', () => {
        const result = formatLogMessage('trace', 'Only empty key', { "": "" });
        expect(result).toBe('[TRACE] Only empty key {"":""}');
    });

    it('handles properties with spaces in keys batch 5 part 19', () => {
        const result = formatLogMessage('info', 'Space key', { "a b": "c" });
        expect(result).toBe('[INFO] Space key {"a b":"c"}');
    });


    it('handles boolean false values in arrays batch 6 part 19', () => {
        const result = formatLogMessage('info', 'Bool array', { arr: [false, false] });
        expect(result).toBe('[INFO] Bool array {"arr":[false,false]}');
    });

    it('handles multiple types in an array batch 6 part 19', () => {
        const result = formatLogMessage('debug', 'Mixed array', { arr: [null, undefined, 1, 'str', false] });
        expect(result).toBe('[DEBUG] Mixed array {"arr":[null,null,1,"str",false]}');
    });

    it('handles special characters in keys batch 6 part 19', () => {
        const result = formatLogMessage('warn', 'Special keys', { "@#$": "%^&" });
        expect(result).toBe('[WARN] Special keys {"@#$":"%^&"}');
    });

    it('handles extremely long messages batch 6 part 19', () => {
        const longMsg = 'A'.repeat(1000);
        const result = formatLogMessage('error', longMsg);
        expect(result).toBe(`[ERROR] ${longMsg}`);
    });

    it('handles extremely deep nested objects batch 6 part 19', () => {
        const result = formatLogMessage('trace', 'Very deep', { a: { b: { c: { d: { e: { f: 1 } } } } } });
        expect(result).toBe('[TRACE] Very deep {"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}');
    });


    it('handles boolean values in metadata batch 7 part 19', () => {
        const result = formatLogMessage('info', 'Booleans', { truthy: true, falsy: false });
        expect(result).toBe('[INFO] Booleans {"truthy":true,"falsy":false}');
    });

    it('handles numeric keys in metadata batch 7 part 19', () => {
        const result = formatLogMessage('info', 'Numbers', { 1: "one", 2: "two" });
        expect(result).toBe('[INFO] Numbers {"1":"one","2":"two"}');
    });

    it('handles an empty message with metadata batch 7 part 19', () => {
        const result = formatLogMessage('info', '', { meta: "data" });
        expect(result).toBe('[INFO]  {"meta":"data"}');
    });

    it('handles null level batch 7 part 19', () => {
        const result = formatLogMessage(null as any, 'Null level test');
        expect(result).toBe('[NULL] Null level test');
    });


    it('handles formatLogMessage with undefined level throws Error', () => {
        expect(() => formatLogMessage(undefined as any, 'msg')).toThrow(TypeError);
    });

    it('handles stringify with bigints in log', () => {
        expect(() => formatLogMessage('info', 'msg', { bi: BigInt(10) })).toThrow(TypeError);
    });

    it('handles stringify with circular references in log', () => {
         const obj: any = {};
         obj.self = obj;
         expect(() => formatLogMessage('info', 'msg', obj)).toThrow(TypeError);
    });


    // --- Added for Batch 19 Part 4 ---

    it('handles formatLogMessage with Symbol level batch 4 part 19', () => {
        const result = formatLogMessage(Symbol('level') as any, 'msg');
        expect(result).toBe('[SYMBOL(LEVEL)] msg');
    });

    it('handles formatLogMessage with NaN level batch 4 part 19', () => {
        const result = formatLogMessage(NaN as any, 'msg');
        expect(result).toBe('[NAN] msg');
    });

    it('handles formatLogMessage with function metadata is stringified out batch 4 part 19', () => {
        const result = formatLogMessage('info', 'msg', { fn: () => {} });
        expect(result).toBe('[INFO] msg {}');
    });


    it('handles formatLogMessage with Symbol level as metadata batch 4 part 19', () => {
        const result = formatLogMessage('info', 'msg', { sym: Symbol('sym') });
        expect(result).toBe('[INFO] msg {}'); // Symbol is omitted in JSON.stringify
    });

    it('handles formatLogMessage with deeply nested metadata batch 4 part 19', () => {
        const result = formatLogMessage('info', 'msg', { a: { b: { c: 1 } } });
        expect(result).toBe('[INFO] msg {"a":{"b":{"c":1}}}');
    });


    it('handles formatLogMessage with empty string level batch 4 part 20', () => {
        const result = formatLogMessage('', 'msg');
        expect(result).toBe('[] msg');
    });

    it('handles formatLogMessage with empty string message batch 4 part 20', () => {
        const result = formatLogMessage('info', '');
        expect(result).toBe('[INFO] ');
    });

    it('handles formatLogMessage with metadata containing array batch 4 part 20', () => {
        const result = formatLogMessage('info', 'msg', { arr: [1, 2, 3] });
        expect(result).toBe('[INFO] msg {"arr":[1,2,3]}');
    });

    it('handles formatLogMessage with metadata containing null batch 4 part 20', () => {
        const result = formatLogMessage('info', 'msg', { val: null });
        expect(result).toBe('[INFO] msg {"val":null}');
    });

    it('handles formatLogMessage with metadata containing boolean batch 4 part 20', () => {
        const result = formatLogMessage('info', 'msg', { val: false });
        expect(result).toBe('[INFO] msg {"val":false}');
    });


    it('handles formatLogMessage with metadata containing special characters batch 21', () => {
        const result = formatLogMessage('info', 'msg', { str: '!@#$%^&*()_+-=[]{}|;:",./<>?' });
        // Expected string handles the escaped quote correctly.
        expect(result).toBe('[INFO] msg {"str":"!@#$%^&*()_+-=[]{}|;:\\",./<>?"}');
    });

    it('handles formatLogMessage with metadata containing large strings batch 21', () => {
        const result = formatLogMessage('info', 'msg', { str: 'a'.repeat(100) });
        expect(result).toBe('[INFO] msg {"str":"' + 'a'.repeat(100) + '"}');
    });

    it('handles formatLogMessage with metadata containing nested arrays batch 21', () => {
        const result = formatLogMessage('info', 'msg', { arr: [[1, 2], [3, 4]] });
        expect(result).toBe('[INFO] msg {"arr":[[1,2],[3,4]]}');
    });


    it('handles formatLogMessage with metadata containing deeply nested objects batch 22', () => {
        const result = formatLogMessage('info', 'msg', { a: { b: { c: { d: { e: 'f' } } } } });
        expect(result).toBe('[INFO] msg {"a":{"b":{"c":{"d":{"e":"f"}}}}}');
    });

    it('handles formatLogMessage with boolean values in metadata batch 22', () => {
        const result = formatLogMessage('info', 'msg', { isActive: true, hasErrors: false });
        expect(result).toBe('[INFO] msg {"isActive":true,"hasErrors":false}');
    });

    it('handles formatLogMessage with numeric values in metadata batch 22', () => {
        const result = formatLogMessage('info', 'msg', { count: 42, price: 3.14, zero: 0, negative: -10 });
        expect(result).toBe('[INFO] msg {"count":42,"price":3.14,"zero":0,"negative":-10}');
    });


    it('handles formatLogMessage with a function inside metadata batch 21', () => {
        const result = formatLogMessage('info', 'msg', { func: () => {} });
        expect(result).toBe('[INFO] msg {}');
    });

    it('handles formatLogMessage with null level batch 21', () => {
        const result = formatLogMessage(null as any, 'msg');
        expect(result).toBe('[NULL] msg');
    });

    it('handles formatLogMessage with missing level batch 21', () => {
        expect(() => formatLogMessage(undefined as any, 'msg')).toThrow(TypeError);
        expect(() => formatLogMessage(undefined as any, 'msg')).toThrow('Missing level');
    });

    it('handles formatLogMessage with array of objects in metadata batch 21', () => {
        const result = formatLogMessage('info', 'msg', { arr: [{a: 1}, {b: 2}] });
        expect(result).toBe('[INFO] msg {"arr":[{"a":1},{"b":2}]}');
    });

    it('handles formatLogMessage with boolean values in metadata batch 21_1', () => {
        const result = formatLogMessage('debug', 'flags', { active: true, pending: false });
        expect(result).toBe('[DEBUG] flags {"active":true,"pending":false}');
    });

    it('handles formatLogMessage with extremely long message batch 21_1', () => {
        const longMsg = 'a'.repeat(1000);
        const result = formatLogMessage('info', longMsg);
        expect(result).toBe('[INFO] ' + longMsg);
    });

    it('handles formatLogMessage with nested null values batch 21_1', () => {
        const result = formatLogMessage('warn', 'msg', { data: { inner: null } });
        expect(result).toBe('[WARN] msg {"data":{"inner":null}}');
    });

    it('handles formatLogMessage with numeric strings in metadata batch 23_1', () => {
        const result = formatLogMessage('info', 'msg', { id: "123" });
        expect(result).toBe('[INFO] msg {"id":"123"}');
    });

    it('handles formatLogMessage with mixed numeric and string values in metadata batch 23_1', () => {
        const result = formatLogMessage('debug', 'mixed', { a: 1, b: "two" });
        expect(result).toBe('[DEBUG] mixed {"a":1,"b":"two"}');
    });

    it('handles formatLogMessage with deeply nested structures in metadata batch 23_1', () => {
        const result = formatLogMessage('warn', 'deep', { a: { b: { c: { d: 4 } } } });
        expect(result).toBe('[WARN] deep {"a":{"b":{"c":{"d":4}}}}');
    });

    it('handles formatLogMessage with empty string metadata key batch 23_1', () => {
        const result = formatLogMessage('info', 'empty key', { "": "value" });
        expect(result).toBe('[INFO] empty key {"":"value"}');
    });

    it('handles formatLogMessage with array of strings in metadata batch 23_1', () => {
        const result = formatLogMessage('info', 'arr', { tags: ["a", "b", "c"] });
        expect(result).toBe('[INFO] arr {"tags":["a","b","c"]}');
    });

    it('handles formatLogMessage with large numbers in metadata batch 24', () => {
        const result = formatLogMessage('info', 'msg', { num: 9007199254740991 });
        expect(result).toBe('[INFO] msg {"num":9007199254740991}');
    });

    it('handles formatLogMessage with negative numbers in metadata batch 24', () => {
        const result = formatLogMessage('info', 'msg', { num: -42 });
        expect(result).toBe('[INFO] msg {"num":-42}');
    });

    it('handles formatLogMessage with floating point numbers in metadata batch 24', () => {
        const result = formatLogMessage('info', 'msg', { num: 3.14159 });
        expect(result).toBe('[INFO] msg {"num":3.14159}');
    });

    it('handles formatLogMessage with boolean values in array metadata batch 24', () => {
        const result = formatLogMessage('info', 'msg', { arr: [true, false] });
        expect(result).toBe('[INFO] msg {"arr":[true,false]}');
    });

    it('handles formatLogMessage with mixed types in array metadata batch 24', () => {
        const result = formatLogMessage('info', 'msg', { arr: [1, "two", false, null] });
        expect(result).toBe('[INFO] msg {"arr":[1,"two",false,null]}');
    });
});
