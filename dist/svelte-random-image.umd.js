(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = global || self, factory(global.svelteRandomImage = {}));
}(this, (function (exports) { 'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function is_promise(value) {
        return value && typeof value === 'object' && typeof value.then === 'function';
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function empty() {
        return text('');
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment) {
            $$.update($$.dirty);
            run_all($$.before_update);
            $$.fragment.p($$.dirty, $$.ctx);
            $$.dirty = null;
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function handle_promise(promise, info) {
        const token = info.token = {};
        function update(type, index, key, value) {
            if (info.token !== token)
                return;
            info.resolved = key && { [key]: value };
            const child_ctx = assign(assign({}, info.ctx), info.resolved);
            const block = type && (info.current = type)(child_ctx);
            if (info.block) {
                if (info.blocks) {
                    info.blocks.forEach((block, i) => {
                        if (i !== index && block) {
                            group_outros();
                            transition_out(block, 1, 1, () => {
                                info.blocks[i] = null;
                            });
                            check_outros();
                        }
                    });
                }
                else {
                    info.block.d(1);
                }
                block.c();
                transition_in(block, 1);
                block.m(info.mount(), info.anchor);
                flush();
            }
            info.block = block;
            if (info.blocks)
                info.blocks[index] = block;
        }
        if (is_promise(promise)) {
            const current_component = get_current_component();
            promise.then(value => {
                set_current_component(current_component);
                update(info.then, 1, info.value, value);
                set_current_component(null);
            }, error => {
                set_current_component(current_component);
                update(info.catch, 2, info.error, error);
                set_current_component(null);
            });
            // if we previously had a then/catch block, destroy it
            if (info.current !== info.pending) {
                update(info.pending, 0);
                return true;
            }
        }
        else {
            if (info.current !== info.then) {
                update(info.then, 1, info.value, promise);
                return true;
            }
            info.resolved = { [info.value]: promise };
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        if (component.$$.fragment) {
            run_all(component.$$.on_destroy);
            component.$$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            component.$$.on_destroy = component.$$.fragment = null;
            component.$$.ctx = {};
        }
    }
    function make_dirty(component, key) {
        if (!component.$$.dirty) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty = blank_object();
        }
        component.$$.dirty[key] = true;
    }
    function init(component, options, instance, create_fragment, not_equal, prop_names) {
        const parent_component = current_component;
        set_current_component(component);
        const props = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props: prop_names,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty: null
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, props, (key, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[key], $$.ctx[key] = value)) {
                    if ($$.bound[key])
                        $$.bound[key](value);
                    if (ready)
                        make_dirty(component, key);
                }
                return ret;
            })
            : props;
        $$.update();
        ready = true;
        run_all($$.before_update);
        $$.fragment = create_fragment($$.ctx);
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation. All rights reserved.
    Licensed under the Apache License, Version 2.0 (the "License"); you may not use
    this file except in compliance with the License. You may obtain a copy of the
    License at http://www.apache.org/licenses/LICENSE-2.0

    THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
    WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
    MERCHANTABLITY OR NON-INFRINGEMENT.

    See the Apache Version 2.0 License for specific language governing permissions
    and limitations under the License.
    ***************************************************************************** */
    /* global Reflect, Promise */

    var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };

    function __extends(d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }

    function __awaiter(thisArg, _arguments, P, generator) {
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
            function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    }

    function __generator(thisArg, body) {
        var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
        return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
        function verb(n) { return function (v) { return step([n, v]); }; }
        function step(op) {
            if (f) throw new TypeError("Generator is already executing.");
            while (_) try {
                if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
                if (y = 0, t) op = [op[0] & 2, t.value];
                switch (op[0]) {
                    case 0: case 1: t = op; break;
                    case 4: _.label++; return { value: op[1], done: false };
                    case 5: _.label++; y = op[1]; op = [0]; continue;
                    case 7: op = _.ops.pop(); _.trys.pop(); continue;
                    default:
                        if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                        if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                        if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                        if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                        if (t[2]) _.ops.pop();
                        _.trys.pop(); continue;
                }
                op = body.call(thisArg, _);
            } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
            if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
        }
    }

    /**
     * Represents the base `Encoder` class for all image encoders to inherit from
     */
    var Encoder = /** @class */ (function () {
        /**
         * Constructor for `Encoder`
         */
        function Encoder(options) {
            if (options === void 0) { options = {}; }
            /**
             * Represents the mime type of the `Encoder`
             */
            this.mime_type = "";
            this.options = options;
        }
        /**
         * Encodes the given image data and returns the encoded results
         */
        Encoder.prototype.encode = function (data, height, width) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    throw new Error("bad dispatch to 'Encoder.encode' (unimplemented encoder)");
                });
            });
        };
        return Encoder;
    }());

    /*
      Copyright (c) 2008, Adobe Systems Incorporated
      All rights reserved.

      Redistribution and use in source and binary forms, with or without 
      modification, are permitted provided that the following conditions are
      met:

      * Redistributions of source code must retain the above copyright notice, 
        this list of conditions and the following disclaimer.
      
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the 
        documentation and/or other materials provided with the distribution.
      
      * Neither the name of Adobe Systems Incorporated nor the names of its 
        contributors may be used to endorse or promote products derived from 
        this software without specific prior written permission.

      THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
      IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
      THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
      PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR 
      CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
      EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
      PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
      PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
      LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
      NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
      SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
    */
    /*
    JPEG encoder ported to JavaScript and optimized by Andreas Ritter, www.bytestrom.eu, 11/2009

    Basic GUI blocking jpeg encoder
    */

    function JPEGEncoder(quality) {
        var ffloor = Math.floor;
        var YTable = new Array(64);
        var UVTable = new Array(64);
        var fdtbl_Y = new Array(64);
        var fdtbl_UV = new Array(64);
        var YDC_HT;
        var UVDC_HT;
        var YAC_HT;
        var UVAC_HT;

        var bitcode = new Array(65535);
        var category = new Array(65535);
        var outputfDCTQuant = new Array(64);
        var DU = new Array(64);
        var byteout = [];
        var bytenew = 0;
        var bytepos = 7;

        var YDU = new Array(64);
        var UDU = new Array(64);
        var VDU = new Array(64);
        var clt = new Array(256);
        var RGB_YUV_TABLE = new Array(2048);
        var currentQuality;

        var ZigZag = [
            0,
            1,
            5,
            6,
            14,
            15,
            27,
            28,
            2,
            4,
            7,
            13,
            16,
            26,
            29,
            42,
            3,
            8,
            12,
            17,
            25,
            30,
            41,
            43,
            9,
            11,
            18,
            24,
            31,
            40,
            44,
            53,
            10,
            19,
            23,
            32,
            39,
            45,
            52,
            54,
            20,
            22,
            33,
            38,
            46,
            51,
            55,
            60,
            21,
            34,
            37,
            47,
            50,
            56,
            59,
            61,
            35,
            36,
            48,
            49,
            57,
            58,
            62,
            63
        ];

        var std_dc_luminance_nrcodes = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
        var std_dc_luminance_values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        var std_ac_luminance_nrcodes = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
        var std_ac_luminance_values = [
            0x01,
            0x02,
            0x03,
            0x00,
            0x04,
            0x11,
            0x05,
            0x12,
            0x21,
            0x31,
            0x41,
            0x06,
            0x13,
            0x51,
            0x61,
            0x07,
            0x22,
            0x71,
            0x14,
            0x32,
            0x81,
            0x91,
            0xa1,
            0x08,
            0x23,
            0x42,
            0xb1,
            0xc1,
            0x15,
            0x52,
            0xd1,
            0xf0,
            0x24,
            0x33,
            0x62,
            0x72,
            0x82,
            0x09,
            0x0a,
            0x16,
            0x17,
            0x18,
            0x19,
            0x1a,
            0x25,
            0x26,
            0x27,
            0x28,
            0x29,
            0x2a,
            0x34,
            0x35,
            0x36,
            0x37,
            0x38,
            0x39,
            0x3a,
            0x43,
            0x44,
            0x45,
            0x46,
            0x47,
            0x48,
            0x49,
            0x4a,
            0x53,
            0x54,
            0x55,
            0x56,
            0x57,
            0x58,
            0x59,
            0x5a,
            0x63,
            0x64,
            0x65,
            0x66,
            0x67,
            0x68,
            0x69,
            0x6a,
            0x73,
            0x74,
            0x75,
            0x76,
            0x77,
            0x78,
            0x79,
            0x7a,
            0x83,
            0x84,
            0x85,
            0x86,
            0x87,
            0x88,
            0x89,
            0x8a,
            0x92,
            0x93,
            0x94,
            0x95,
            0x96,
            0x97,
            0x98,
            0x99,
            0x9a,
            0xa2,
            0xa3,
            0xa4,
            0xa5,
            0xa6,
            0xa7,
            0xa8,
            0xa9,
            0xaa,
            0xb2,
            0xb3,
            0xb4,
            0xb5,
            0xb6,
            0xb7,
            0xb8,
            0xb9,
            0xba,
            0xc2,
            0xc3,
            0xc4,
            0xc5,
            0xc6,
            0xc7,
            0xc8,
            0xc9,
            0xca,
            0xd2,
            0xd3,
            0xd4,
            0xd5,
            0xd6,
            0xd7,
            0xd8,
            0xd9,
            0xda,
            0xe1,
            0xe2,
            0xe3,
            0xe4,
            0xe5,
            0xe6,
            0xe7,
            0xe8,
            0xe9,
            0xea,
            0xf1,
            0xf2,
            0xf3,
            0xf4,
            0xf5,
            0xf6,
            0xf7,
            0xf8,
            0xf9,
            0xfa
        ];

        var std_dc_chrominance_nrcodes = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
        var std_dc_chrominance_values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        var std_ac_chrominance_nrcodes = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
        var std_ac_chrominance_values = [
            0x00,
            0x01,
            0x02,
            0x03,
            0x11,
            0x04,
            0x05,
            0x21,
            0x31,
            0x06,
            0x12,
            0x41,
            0x51,
            0x07,
            0x61,
            0x71,
            0x13,
            0x22,
            0x32,
            0x81,
            0x08,
            0x14,
            0x42,
            0x91,
            0xa1,
            0xb1,
            0xc1,
            0x09,
            0x23,
            0x33,
            0x52,
            0xf0,
            0x15,
            0x62,
            0x72,
            0xd1,
            0x0a,
            0x16,
            0x24,
            0x34,
            0xe1,
            0x25,
            0xf1,
            0x17,
            0x18,
            0x19,
            0x1a,
            0x26,
            0x27,
            0x28,
            0x29,
            0x2a,
            0x35,
            0x36,
            0x37,
            0x38,
            0x39,
            0x3a,
            0x43,
            0x44,
            0x45,
            0x46,
            0x47,
            0x48,
            0x49,
            0x4a,
            0x53,
            0x54,
            0x55,
            0x56,
            0x57,
            0x58,
            0x59,
            0x5a,
            0x63,
            0x64,
            0x65,
            0x66,
            0x67,
            0x68,
            0x69,
            0x6a,
            0x73,
            0x74,
            0x75,
            0x76,
            0x77,
            0x78,
            0x79,
            0x7a,
            0x82,
            0x83,
            0x84,
            0x85,
            0x86,
            0x87,
            0x88,
            0x89,
            0x8a,
            0x92,
            0x93,
            0x94,
            0x95,
            0x96,
            0x97,
            0x98,
            0x99,
            0x9a,
            0xa2,
            0xa3,
            0xa4,
            0xa5,
            0xa6,
            0xa7,
            0xa8,
            0xa9,
            0xaa,
            0xb2,
            0xb3,
            0xb4,
            0xb5,
            0xb6,
            0xb7,
            0xb8,
            0xb9,
            0xba,
            0xc2,
            0xc3,
            0xc4,
            0xc5,
            0xc6,
            0xc7,
            0xc8,
            0xc9,
            0xca,
            0xd2,
            0xd3,
            0xd4,
            0xd5,
            0xd6,
            0xd7,
            0xd8,
            0xd9,
            0xda,
            0xe2,
            0xe3,
            0xe4,
            0xe5,
            0xe6,
            0xe7,
            0xe8,
            0xe9,
            0xea,
            0xf2,
            0xf3,
            0xf4,
            0xf5,
            0xf6,
            0xf7,
            0xf8,
            0xf9,
            0xfa
        ];

        function initQuantTables(sf) {
            var YQT = [
                16,
                11,
                10,
                16,
                24,
                40,
                51,
                61,
                12,
                12,
                14,
                19,
                26,
                58,
                60,
                55,
                14,
                13,
                16,
                24,
                40,
                57,
                69,
                56,
                14,
                17,
                22,
                29,
                51,
                87,
                80,
                62,
                18,
                22,
                37,
                56,
                68,
                109,
                103,
                77,
                24,
                35,
                55,
                64,
                81,
                104,
                113,
                92,
                49,
                64,
                78,
                87,
                103,
                121,
                120,
                101,
                72,
                92,
                95,
                98,
                112,
                100,
                103,
                99
            ];

            for (var i = 0; i < 64; i++) {
                var t = ffloor((YQT[i] * sf + 50) / 100);
                if (t < 1) {
                    t = 1;
                } else if (t > 255) {
                    t = 255;
                }
                YTable[ZigZag[i]] = t;
            }
            var UVQT = [
                17,
                18,
                24,
                47,
                99,
                99,
                99,
                99,
                18,
                21,
                26,
                66,
                99,
                99,
                99,
                99,
                24,
                26,
                56,
                99,
                99,
                99,
                99,
                99,
                47,
                66,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99,
                99
            ];
            for (var j = 0; j < 64; j++) {
                var u = ffloor((UVQT[j] * sf + 50) / 100);
                if (u < 1) {
                    u = 1;
                } else if (u > 255) {
                    u = 255;
                }
                UVTable[ZigZag[j]] = u;
            }
            var aasf = [
                1.0,
                1.387039845,
                1.306562965,
                1.175875602,
                1.0,
                0.785694958,
                0.5411961,
                0.275899379
            ];
            var k = 0;
            for (var row = 0; row < 8; row++) {
                for (var col = 0; col < 8; col++) {
                    fdtbl_Y[k] = 1.0 / (YTable[ZigZag[k]] * aasf[row] * aasf[col] * 8.0);
                    fdtbl_UV[k] = 1.0 / (UVTable[ZigZag[k]] * aasf[row] * aasf[col] * 8.0);
                    k++;
                }
            }
        }

        function computeHuffmanTbl(nrcodes, std_table) {
            var codevalue = 0;
            var pos_in_table = 0;
            var HT = new Array();
            for (var k = 1; k <= 16; k++) {
                for (var j = 1; j <= nrcodes[k]; j++) {
                    HT[std_table[pos_in_table]] = [];
                    HT[std_table[pos_in_table]][0] = codevalue;
                    HT[std_table[pos_in_table]][1] = k;
                    pos_in_table++;
                    codevalue++;
                }
                codevalue *= 2;
            }
            return HT;
        }

        function initHuffmanTbl() {
            YDC_HT = computeHuffmanTbl(std_dc_luminance_nrcodes, std_dc_luminance_values);
            UVDC_HT = computeHuffmanTbl(std_dc_chrominance_nrcodes, std_dc_chrominance_values);
            YAC_HT = computeHuffmanTbl(std_ac_luminance_nrcodes, std_ac_luminance_values);
            UVAC_HT = computeHuffmanTbl(std_ac_chrominance_nrcodes, std_ac_chrominance_values);
        }

        function initCategoryNumber() {
            var nrlower = 1;
            var nrupper = 2;
            for (var cat = 1; cat <= 15; cat++) {
                //Positive numbers
                for (var nr = nrlower; nr < nrupper; nr++) {
                    category[32767 + nr] = cat;
                    bitcode[32767 + nr] = [];
                    bitcode[32767 + nr][1] = cat;
                    bitcode[32767 + nr][0] = nr;
                }
                //Negative numbers
                for (var nrneg = -(nrupper - 1); nrneg <= -nrlower; nrneg++) {
                    category[32767 + nrneg] = cat;
                    bitcode[32767 + nrneg] = [];
                    bitcode[32767 + nrneg][1] = cat;
                    bitcode[32767 + nrneg][0] = nrupper - 1 + nrneg;
                }
                nrlower <<= 1;
                nrupper <<= 1;
            }
        }

        function initRGBYUVTable() {
            for (var i = 0; i < 256; i++) {
                RGB_YUV_TABLE[i] = 19595 * i;
                RGB_YUV_TABLE[(i + 256) >> 0] = 38470 * i;
                RGB_YUV_TABLE[(i + 512) >> 0] = 7471 * i + 0x8000;
                RGB_YUV_TABLE[(i + 768) >> 0] = -11059 * i;
                RGB_YUV_TABLE[(i + 1024) >> 0] = -21709 * i;
                RGB_YUV_TABLE[(i + 1280) >> 0] = 32768 * i + 0x807fff;
                RGB_YUV_TABLE[(i + 1536) >> 0] = -27439 * i;
                RGB_YUV_TABLE[(i + 1792) >> 0] = -5329 * i;
            }
        }

        // IO functions
        function writeBits(bs) {
            var value = bs[0];
            var posval = bs[1] - 1;
            while (posval >= 0) {
                if (value & (1 << posval)) {
                    bytenew |= 1 << bytepos;
                }
                posval--;
                bytepos--;
                if (bytepos < 0) {
                    if (bytenew == 0xff) {
                        writeByte(0xff);
                        writeByte(0);
                    } else {
                        writeByte(bytenew);
                    }
                    bytepos = 7;
                    bytenew = 0;
                }
            }
        }

        function writeByte(value) {
            //byteout.push(clt[value]); // write char directly instead of converting later
            byteout.push(value);
        }

        function writeWord(value) {
            writeByte((value >> 8) & 0xff);
            writeByte(value & 0xff);
        }

        // DCT & quantization core
        function fDCTQuant(data, fdtbl) {
            var d0, d1, d2, d3, d4, d5, d6, d7;
            /* Pass 1: process rows. */
            var dataOff = 0;
            var i;
            var I8 = 8;
            var I64 = 64;
            for (i = 0; i < I8; ++i) {
                d0 = data[dataOff];
                d1 = data[dataOff + 1];
                d2 = data[dataOff + 2];
                d3 = data[dataOff + 3];
                d4 = data[dataOff + 4];
                d5 = data[dataOff + 5];
                d6 = data[dataOff + 6];
                d7 = data[dataOff + 7];

                var tmp0 = d0 + d7;
                var tmp7 = d0 - d7;
                var tmp1 = d1 + d6;
                var tmp6 = d1 - d6;
                var tmp2 = d2 + d5;
                var tmp5 = d2 - d5;
                var tmp3 = d3 + d4;
                var tmp4 = d3 - d4;

                /* Even part */
                var tmp10 = tmp0 + tmp3; /* phase 2 */
                var tmp13 = tmp0 - tmp3;
                var tmp11 = tmp1 + tmp2;
                var tmp12 = tmp1 - tmp2;

                data[dataOff] = tmp10 + tmp11; /* phase 3 */
                data[dataOff + 4] = tmp10 - tmp11;

                var z1 = (tmp12 + tmp13) * 0.707106781; /* c4 */
                data[dataOff + 2] = tmp13 + z1; /* phase 5 */
                data[dataOff + 6] = tmp13 - z1;

                /* Odd part */
                tmp10 = tmp4 + tmp5; /* phase 2 */
                tmp11 = tmp5 + tmp6;
                tmp12 = tmp6 + tmp7;

                /* The rotator is modified from fig 4-8 to avoid extra negations. */
                var z5 = (tmp10 - tmp12) * 0.382683433; /* c6 */
                var z2 = 0.5411961 * tmp10 + z5; /* c2-c6 */
                var z4 = 1.306562965 * tmp12 + z5; /* c2+c6 */
                var z3 = tmp11 * 0.707106781; /* c4 */

                var z11 = tmp7 + z3; /* phase 5 */
                var z13 = tmp7 - z3;

                data[dataOff + 5] = z13 + z2; /* phase 6 */
                data[dataOff + 3] = z13 - z2;
                data[dataOff + 1] = z11 + z4;
                data[dataOff + 7] = z11 - z4;

                dataOff += 8; /* advance pointer to next row */
            }

            /* Pass 2: process columns. */
            dataOff = 0;
            for (i = 0; i < I8; ++i) {
                d0 = data[dataOff];
                d1 = data[dataOff + 8];
                d2 = data[dataOff + 16];
                d3 = data[dataOff + 24];
                d4 = data[dataOff + 32];
                d5 = data[dataOff + 40];
                d6 = data[dataOff + 48];
                d7 = data[dataOff + 56];

                var tmp0p2 = d0 + d7;
                var tmp7p2 = d0 - d7;
                var tmp1p2 = d1 + d6;
                var tmp6p2 = d1 - d6;
                var tmp2p2 = d2 + d5;
                var tmp5p2 = d2 - d5;
                var tmp3p2 = d3 + d4;
                var tmp4p2 = d3 - d4;

                /* Even part */
                var tmp10p2 = tmp0p2 + tmp3p2; /* phase 2 */
                var tmp13p2 = tmp0p2 - tmp3p2;
                var tmp11p2 = tmp1p2 + tmp2p2;
                var tmp12p2 = tmp1p2 - tmp2p2;

                data[dataOff] = tmp10p2 + tmp11p2; /* phase 3 */
                data[dataOff + 32] = tmp10p2 - tmp11p2;

                var z1p2 = (tmp12p2 + tmp13p2) * 0.707106781; /* c4 */
                data[dataOff + 16] = tmp13p2 + z1p2; /* phase 5 */
                data[dataOff + 48] = tmp13p2 - z1p2;

                /* Odd part */
                tmp10p2 = tmp4p2 + tmp5p2; /* phase 2 */
                tmp11p2 = tmp5p2 + tmp6p2;
                tmp12p2 = tmp6p2 + tmp7p2;

                /* The rotator is modified from fig 4-8 to avoid extra negations. */
                var z5p2 = (tmp10p2 - tmp12p2) * 0.382683433; /* c6 */
                var z2p2 = 0.5411961 * tmp10p2 + z5p2; /* c2-c6 */
                var z4p2 = 1.306562965 * tmp12p2 + z5p2; /* c2+c6 */
                var z3p2 = tmp11p2 * 0.707106781; /* c4 */

                var z11p2 = tmp7p2 + z3p2; /* phase 5 */
                var z13p2 = tmp7p2 - z3p2;

                data[dataOff + 40] = z13p2 + z2p2; /* phase 6 */
                data[dataOff + 24] = z13p2 - z2p2;
                data[dataOff + 8] = z11p2 + z4p2;
                data[dataOff + 56] = z11p2 - z4p2;

                dataOff++; /* advance pointer to next column */
            }

            // Quantize/descale the coefficients
            var fDCTQuant;
            for (i = 0; i < I64; ++i) {
                // Apply the quantization and scaling factor & Round to nearest integer
                fDCTQuant = data[i] * fdtbl[i];
                outputfDCTQuant[i] = fDCTQuant > 0.0 ? (fDCTQuant + 0.5) | 0 : (fDCTQuant - 0.5) | 0;
                //outputfDCTQuant[i] = fround(fDCTQuant);
            }
            return outputfDCTQuant;
        }

        function writeAPP0() {
            writeWord(0xffe0); // marker
            writeWord(16); // length
            writeByte(0x4a); // J
            writeByte(0x46); // F
            writeByte(0x49); // I
            writeByte(0x46); // F
            writeByte(0); // = "JFIF",'\0'
            writeByte(1); // versionhi
            writeByte(1); // versionlo
            writeByte(0); // xyunits
            writeWord(1); // xdensity
            writeWord(1); // ydensity
            writeByte(0); // thumbnwidth
            writeByte(0); // thumbnheight
        }

        function writeSOF0(width, height) {
            writeWord(0xffc0); // marker
            writeWord(17); // length, truecolor YUV JPG
            writeByte(8); // precision
            writeWord(height);
            writeWord(width);
            writeByte(3); // nrofcomponents
            writeByte(1); // IdY
            writeByte(0x11); // HVY
            writeByte(0); // QTY
            writeByte(2); // IdU
            writeByte(0x11); // HVU
            writeByte(1); // QTU
            writeByte(3); // IdV
            writeByte(0x11); // HVV
            writeByte(1); // QTV
        }

        function writeDQT() {
            writeWord(0xffdb); // marker
            writeWord(132); // length
            writeByte(0);
            for (var i = 0; i < 64; i++) {
                writeByte(YTable[i]);
            }
            writeByte(1);
            for (var j = 0; j < 64; j++) {
                writeByte(UVTable[j]);
            }
        }

        function writeDHT() {
            writeWord(0xffc4); // marker
            writeWord(0x01a2); // length

            writeByte(0); // HTYDCinfo
            for (var i = 0; i < 16; i++) {
                writeByte(std_dc_luminance_nrcodes[i + 1]);
            }
            for (var j = 0; j <= 11; j++) {
                writeByte(std_dc_luminance_values[j]);
            }

            writeByte(0x10); // HTYACinfo
            for (var k = 0; k < 16; k++) {
                writeByte(std_ac_luminance_nrcodes[k + 1]);
            }
            for (var l = 0; l <= 161; l++) {
                writeByte(std_ac_luminance_values[l]);
            }

            writeByte(1); // HTUDCinfo
            for (var m = 0; m < 16; m++) {
                writeByte(std_dc_chrominance_nrcodes[m + 1]);
            }
            for (var n = 0; n <= 11; n++) {
                writeByte(std_dc_chrominance_values[n]);
            }

            writeByte(0x11); // HTUACinfo
            for (var o = 0; o < 16; o++) {
                writeByte(std_ac_chrominance_nrcodes[o + 1]);
            }
            for (var p = 0; p <= 161; p++) {
                writeByte(std_ac_chrominance_values[p]);
            }
        }

        function writeSOS() {
            writeWord(0xffda); // marker
            writeWord(12); // length
            writeByte(3); // nrofcomponents
            writeByte(1); // IdY
            writeByte(0); // HTY
            writeByte(2); // IdU
            writeByte(0x11); // HTU
            writeByte(3); // IdV
            writeByte(0x11); // HTV
            writeByte(0); // Ss
            writeByte(0x3f); // Se
            writeByte(0); // Bf
        }

        function processDU(CDU, fdtbl, DC, HTDC, HTAC) {
            var EOB = HTAC[0x00];
            var M16zeroes = HTAC[0xf0];
            var pos;
            var I16 = 16;
            var I63 = 63;
            var I64 = 64;
            var DU_DCT = fDCTQuant(CDU, fdtbl);
            //ZigZag reorder
            for (var j = 0; j < I64; ++j) {
                DU[ZigZag[j]] = DU_DCT[j];
            }
            var Diff = DU[0] - DC;
            DC = DU[0];
            //Encode DC
            if (Diff == 0) {
                writeBits(HTDC[0]); // Diff might be 0
            } else {
                pos = 32767 + Diff;
                writeBits(HTDC[category[pos]]);
                writeBits(bitcode[pos]);
            }
            //Encode ACs
            var end0pos = 63; // was const... which is crazy
            for (; end0pos > 0 && DU[end0pos] == 0; end0pos--) {}
            //end0pos = first element in reverse order !=0
            if (end0pos == 0) {
                writeBits(EOB);
                return DC;
            }
            var i = 1;
            var lng;
            while (i <= end0pos) {
                var startpos = i;
                for (; DU[i] == 0 && i <= end0pos; ++i) {}
                var nrzeroes = i - startpos;
                if (nrzeroes >= I16) {
                    lng = nrzeroes >> 4;
                    for (var nrmarker = 1; nrmarker <= lng; ++nrmarker) writeBits(M16zeroes);
                    nrzeroes = nrzeroes & 0xf;
                }
                pos = 32767 + DU[i];
                writeBits(HTAC[(nrzeroes << 4) + category[pos]]);
                writeBits(bitcode[pos]);
                i++;
            }
            if (end0pos != I63) {
                writeBits(EOB);
            }
            return DC;
        }

        function initCharLookupTable() {
            var sfcc = String.fromCharCode;
            for (var i = 0; i < 256; i++) {
                ///// ACHTUNG // 255
                clt[i] = sfcc(i);
            }
        }

        this.encode = function(
            image,
            quality // image data object
        ) {
            var time_start = new Date().getTime();

            if (quality) setQuality(quality);

            // Initialize bit writer
            byteout = new Array();
            bytenew = 0;
            bytepos = 7;

            // Add JPEG headers
            writeWord(0xffd8); // SOI
            writeAPP0();
            writeDQT();
            writeSOF0(image.width, image.height);
            writeDHT();
            writeSOS();

            // Encode 8x8 macroblocks
            var DCY = 0;
            var DCU = 0;
            var DCV = 0;

            bytenew = 0;
            bytepos = 7;

            this.encode.displayName = "_encode_";

            var imageData = image.data;
            var width = image.width;
            var height = image.height;

            var quadWidth = width * 4;

            var x,
                y = 0;
            var r, g, b;
            var start, p, col, row, pos;
            while (y < height) {
                x = 0;
                while (x < quadWidth) {
                    start = quadWidth * y + x;
                    p = start;
                    col = -1;
                    row = 0;

                    for (pos = 0; pos < 64; pos++) {
                        row = pos >> 3; // /8
                        col = (pos & 7) * 4; // %8
                        p = start + row * quadWidth + col;

                        if (y + row >= height) {
                            // padding bottom
                            p -= quadWidth * (y + 1 + row - height);
                        }

                        if (x + col >= quadWidth) {
                            // padding right
                            p -= x + col - quadWidth + 4;
                        }

                        r = imageData[p++];
                        g = imageData[p++];
                        b = imageData[p++];

                        /* // calculate YUV values dynamically
    					YDU[pos]=((( 0.29900)*r+( 0.58700)*g+( 0.11400)*b))-128; //-0x80
    					UDU[pos]=(((-0.16874)*r+(-0.33126)*g+( 0.50000)*b));
    					VDU[pos]=((( 0.50000)*r+(-0.41869)*g+(-0.08131)*b));
    					*/

                        // use lookup table (slightly faster)
                        YDU[pos] =
                            ((RGB_YUV_TABLE[r] +
                                RGB_YUV_TABLE[(g + 256) >> 0] +
                                RGB_YUV_TABLE[(b + 512) >> 0]) >>
                                16) -
                            128;
                        UDU[pos] =
                            ((RGB_YUV_TABLE[(r + 768) >> 0] +
                                RGB_YUV_TABLE[(g + 1024) >> 0] +
                                RGB_YUV_TABLE[(b + 1280) >> 0]) >>
                                16) -
                            128;
                        VDU[pos] =
                            ((RGB_YUV_TABLE[(r + 1280) >> 0] +
                                RGB_YUV_TABLE[(g + 1536) >> 0] +
                                RGB_YUV_TABLE[(b + 1792) >> 0]) >>
                                16) -
                            128;
                    }

                    DCY = processDU(YDU, fdtbl_Y, DCY, YDC_HT, YAC_HT);
                    DCU = processDU(UDU, fdtbl_UV, DCU, UVDC_HT, UVAC_HT);
                    DCV = processDU(VDU, fdtbl_UV, DCV, UVDC_HT, UVAC_HT);
                    x += 32;
                }
                y += 8;
            }

            ////////////////////////////////////////////////////////////////

            // Do the bit alignment of the EOI marker
            if (bytepos >= 0) {
                var fillbits = [];
                fillbits[1] = bytepos + 1;
                fillbits[0] = (1 << (bytepos + 1)) - 1;
                writeBits(fillbits);
            }

            writeWord(0xffd9); //EOI

            return new Uint8Array(byteout);
            //return new Buffer(byteout);
        };

        function setQuality(quality) {
            if (quality <= 0) {
                quality = 1;
            }
            if (quality > 100) {
                quality = 100;
            }

            if (currentQuality == quality) return; // don't recalc if unchanged

            var sf = 0;
            if (quality < 50) {
                sf = Math.floor(5000 / quality);
            } else {
                sf = Math.floor(200 - quality * 2);
            }

            initQuantTables(sf);
            currentQuality = quality;
            //console.log('Quality set to: '+quality +'%');
        }

        function init() {
            var time_start = new Date().getTime();
            if (!quality) quality = 50;
            // Create tables
            initCharLookupTable();
            initHuffmanTbl();
            initCategoryNumber();
            initRGBYUVTable();

            setQuality(quality);
            var duration = new Date().getTime() - time_start;
            //console.log('Initialization '+ duration + 'ms');
        }

        init();
    }

    function encode(imgData, qu) {
        if (typeof qu === "undefined") qu = 50;
        var encoder = new JPEGEncoder(qu);
        var data = encoder.encode(imgData, qu);
        return {
            data: data,
            width: imgData.width,
            height: imgData.height
        };
    }

    var jpegJs = {
        encode: encode
    };
    var jpegJs_1 = jpegJs.encode;

    /**
     * NOTE:
     *  - Even though `JPEGEncoder.encode` returns a `Promise<Uint8Array>` value, it is NOT non-blocking
     */
    /**
     * Represents the class for defaults and normalizing options passed into `JPEGEncoder`
     */
    var JPEGEncoderOptions = /** @class */ (function () {
        /**
         * Constructor for `JPEGEncoderOptions`
         */
        function JPEGEncoderOptions(options) {
            if (options === void 0) { options = {}; }
            this.quality = 100;
            Object.assign(this, options);
        }
        return JPEGEncoderOptions;
    }());
    /**
     * Represents the `Encoder` used for encoding raw image data into JPEG files
     */
    var JPEGEncoder$1 = /** @class */ (function (_super) {
        __extends(JPEGEncoder, _super);
        /**
         * Constructor for `JPEGEncoder`
         */
        function JPEGEncoder(options) {
            if (options === void 0) { options = {}; }
            var _this = _super.call(this, options) || this;
            /**
             * Represents JPEG mime type for the encoder
             */
            _this.mime_type = "image/jpeg";
            _this.options = new JPEGEncoderOptions(options);
            return _this;
        }
        /**
         * Returns the raw image data encoded into a JPEG binary
         */
        JPEGEncoder.prototype.encode = function (data, height, width) {
            return __awaiter(this, void 0, void 0, function () {
                var quality, encode_data, buffer;
                return __generator(this, function (_a) {
                    quality = this.options.quality;
                    encode_data = { data: data, height: height, width: width };
                    buffer = jpegJs_1(encode_data, quality);
                    return [2 /*return*/, new Uint8Array(buffer.data)];
                });
            });
        };
        return JPEGEncoder;
    }(Encoder));

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    function getCjsExportFromNamespace (n) {
    	return n && n['default'] || n;
    }

    var alea = createCommonjsModule(function (module) {
    // A port of an algorithm by Johannes Baagøe <baagoe@baagoe.com>, 2010
    // http://baagoe.com/en/RandomMusings/javascript/
    // https://github.com/nquinlan/better-random-numbers-for-javascript-mirror
    // Original work is under MIT license -

    // Copyright (C) 2010 by Johannes Baagøe <baagoe@baagoe.org>
    //
    // Permission is hereby granted, free of charge, to any person obtaining a copy
    // of this software and associated documentation files (the "Software"), to deal
    // in the Software without restriction, including without limitation the rights
    // to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    // copies of the Software, and to permit persons to whom the Software is
    // furnished to do so, subject to the following conditions:
    //
    // The above copyright notice and this permission notice shall be included in
    // all copies or substantial portions of the Software.
    //
    // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    // IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    // AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    // LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    // OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    // THE SOFTWARE.



    (function(global, module, define) {

    function Alea(seed) {
      var me = this, mash = Mash();

      me.next = function() {
        var t = 2091639 * me.s0 + me.c * 2.3283064365386963e-10; // 2^-32
        me.s0 = me.s1;
        me.s1 = me.s2;
        return me.s2 = t - (me.c = t | 0);
      };

      // Apply the seeding algorithm from Baagoe.
      me.c = 1;
      me.s0 = mash(' ');
      me.s1 = mash(' ');
      me.s2 = mash(' ');
      me.s0 -= mash(seed);
      if (me.s0 < 0) { me.s0 += 1; }
      me.s1 -= mash(seed);
      if (me.s1 < 0) { me.s1 += 1; }
      me.s2 -= mash(seed);
      if (me.s2 < 0) { me.s2 += 1; }
      mash = null;
    }

    function copy(f, t) {
      t.c = f.c;
      t.s0 = f.s0;
      t.s1 = f.s1;
      t.s2 = f.s2;
      return t;
    }

    function impl(seed, opts) {
      var xg = new Alea(seed),
          state = opts && opts.state,
          prng = xg.next;
      prng.int32 = function() { return (xg.next() * 0x100000000) | 0; };
      prng.double = function() {
        return prng() + (prng() * 0x200000 | 0) * 1.1102230246251565e-16; // 2^-53
      };
      prng.quick = prng;
      if (state) {
        if (typeof(state) == 'object') copy(state, xg);
        prng.state = function() { return copy(xg, {}); };
      }
      return prng;
    }

    function Mash() {
      var n = 0xefc8249d;

      var mash = function(data) {
        data = String(data);
        for (var i = 0; i < data.length; i++) {
          n += data.charCodeAt(i);
          var h = 0.02519603282416938 * n;
          n = h >>> 0;
          h -= n;
          h *= n;
          n = h >>> 0;
          h -= n;
          n += h * 0x100000000; // 2^32
        }
        return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
      };

      return mash;
    }


    if (module && module.exports) {
      module.exports = impl;
    } else if (define && define.amd) {
      define(function() { return impl; });
    } else {
      this.alea = impl;
    }

    })(
      commonjsGlobal,
       module,    // present in node.js
      (typeof undefined) == 'function'    // present with an AMD loader
    );
    });

    var xor128 = createCommonjsModule(function (module) {
    // A Javascript implementaion of the "xor128" prng algorithm by
    // George Marsaglia.  See http://www.jstatsoft.org/v08/i14/paper

    (function(global, module, define) {

    function XorGen(seed) {
      var me = this, strseed = '';

      me.x = 0;
      me.y = 0;
      me.z = 0;
      me.w = 0;

      // Set up generator function.
      me.next = function() {
        var t = me.x ^ (me.x << 11);
        me.x = me.y;
        me.y = me.z;
        me.z = me.w;
        return me.w ^= (me.w >>> 19) ^ t ^ (t >>> 8);
      };

      if (seed === (seed | 0)) {
        // Integer seed.
        me.x = seed;
      } else {
        // String seed.
        strseed += seed;
      }

      // Mix in string seed, then discard an initial batch of 64 values.
      for (var k = 0; k < strseed.length + 64; k++) {
        me.x ^= strseed.charCodeAt(k) | 0;
        me.next();
      }
    }

    function copy(f, t) {
      t.x = f.x;
      t.y = f.y;
      t.z = f.z;
      t.w = f.w;
      return t;
    }

    function impl(seed, opts) {
      var xg = new XorGen(seed),
          state = opts && opts.state,
          prng = function() { return (xg.next() >>> 0) / 0x100000000; };
      prng.double = function() {
        do {
          var top = xg.next() >>> 11,
              bot = (xg.next() >>> 0) / 0x100000000,
              result = (top + bot) / (1 << 21);
        } while (result === 0);
        return result;
      };
      prng.int32 = xg.next;
      prng.quick = prng;
      if (state) {
        if (typeof(state) == 'object') copy(state, xg);
        prng.state = function() { return copy(xg, {}); };
      }
      return prng;
    }

    if (module && module.exports) {
      module.exports = impl;
    } else if (define && define.amd) {
      define(function() { return impl; });
    } else {
      this.xor128 = impl;
    }

    })(
      commonjsGlobal,
       module,    // present in node.js
      (typeof undefined) == 'function'    // present with an AMD loader
    );
    });

    var xorwow = createCommonjsModule(function (module) {
    // A Javascript implementaion of the "xorwow" prng algorithm by
    // George Marsaglia.  See http://www.jstatsoft.org/v08/i14/paper

    (function(global, module, define) {

    function XorGen(seed) {
      var me = this, strseed = '';

      // Set up generator function.
      me.next = function() {
        var t = (me.x ^ (me.x >>> 2));
        me.x = me.y; me.y = me.z; me.z = me.w; me.w = me.v;
        return (me.d = (me.d + 362437 | 0)) +
           (me.v = (me.v ^ (me.v << 4)) ^ (t ^ (t << 1))) | 0;
      };

      me.x = 0;
      me.y = 0;
      me.z = 0;
      me.w = 0;
      me.v = 0;

      if (seed === (seed | 0)) {
        // Integer seed.
        me.x = seed;
      } else {
        // String seed.
        strseed += seed;
      }

      // Mix in string seed, then discard an initial batch of 64 values.
      for (var k = 0; k < strseed.length + 64; k++) {
        me.x ^= strseed.charCodeAt(k) | 0;
        if (k == strseed.length) {
          me.d = me.x << 10 ^ me.x >>> 4;
        }
        me.next();
      }
    }

    function copy(f, t) {
      t.x = f.x;
      t.y = f.y;
      t.z = f.z;
      t.w = f.w;
      t.v = f.v;
      t.d = f.d;
      return t;
    }

    function impl(seed, opts) {
      var xg = new XorGen(seed),
          state = opts && opts.state,
          prng = function() { return (xg.next() >>> 0) / 0x100000000; };
      prng.double = function() {
        do {
          var top = xg.next() >>> 11,
              bot = (xg.next() >>> 0) / 0x100000000,
              result = (top + bot) / (1 << 21);
        } while (result === 0);
        return result;
      };
      prng.int32 = xg.next;
      prng.quick = prng;
      if (state) {
        if (typeof(state) == 'object') copy(state, xg);
        prng.state = function() { return copy(xg, {}); };
      }
      return prng;
    }

    if (module && module.exports) {
      module.exports = impl;
    } else if (define && define.amd) {
      define(function() { return impl; });
    } else {
      this.xorwow = impl;
    }

    })(
      commonjsGlobal,
       module,    // present in node.js
      (typeof undefined) == 'function'    // present with an AMD loader
    );
    });

    var xorshift7 = createCommonjsModule(function (module) {
    // A Javascript implementaion of the "xorshift7" algorithm by
    // François Panneton and Pierre L'ecuyer:
    // "On the Xorgshift Random Number Generators"
    // http://saluc.engr.uconn.edu/refs/crypto/rng/panneton05onthexorshift.pdf

    (function(global, module, define) {

    function XorGen(seed) {
      var me = this;

      // Set up generator function.
      me.next = function() {
        // Update xor generator.
        var X = me.x, i = me.i, t, v;
        t = X[i]; t ^= (t >>> 7); v = t ^ (t << 24);
        t = X[(i + 1) & 7]; v ^= t ^ (t >>> 10);
        t = X[(i + 3) & 7]; v ^= t ^ (t >>> 3);
        t = X[(i + 4) & 7]; v ^= t ^ (t << 7);
        t = X[(i + 7) & 7]; t = t ^ (t << 13); v ^= t ^ (t << 9);
        X[i] = v;
        me.i = (i + 1) & 7;
        return v;
      };

      function init(me, seed) {
        var j, w, X = [];

        if (seed === (seed | 0)) {
          // Seed state array using a 32-bit integer.
          w = X[0] = seed;
        } else {
          // Seed state using a string.
          seed = '' + seed;
          for (j = 0; j < seed.length; ++j) {
            X[j & 7] = (X[j & 7] << 15) ^
                (seed.charCodeAt(j) + X[(j + 1) & 7] << 13);
          }
        }
        // Enforce an array length of 8, not all zeroes.
        while (X.length < 8) X.push(0);
        for (j = 0; j < 8 && X[j] === 0; ++j);
        if (j == 8) w = X[7] = -1; else w = X[j];

        me.x = X;
        me.i = 0;

        // Discard an initial 256 values.
        for (j = 256; j > 0; --j) {
          me.next();
        }
      }

      init(me, seed);
    }

    function copy(f, t) {
      t.x = f.x.slice();
      t.i = f.i;
      return t;
    }

    function impl(seed, opts) {
      if (seed == null) seed = +(new Date);
      var xg = new XorGen(seed),
          state = opts && opts.state,
          prng = function() { return (xg.next() >>> 0) / 0x100000000; };
      prng.double = function() {
        do {
          var top = xg.next() >>> 11,
              bot = (xg.next() >>> 0) / 0x100000000,
              result = (top + bot) / (1 << 21);
        } while (result === 0);
        return result;
      };
      prng.int32 = xg.next;
      prng.quick = prng;
      if (state) {
        if (state.x) copy(state, xg);
        prng.state = function() { return copy(xg, {}); };
      }
      return prng;
    }

    if (module && module.exports) {
      module.exports = impl;
    } else if (define && define.amd) {
      define(function() { return impl; });
    } else {
      this.xorshift7 = impl;
    }

    })(
      commonjsGlobal,
       module,    // present in node.js
      (typeof undefined) == 'function'    // present with an AMD loader
    );
    });

    var xor4096 = createCommonjsModule(function (module) {
    // A Javascript implementaion of Richard Brent's Xorgens xor4096 algorithm.
    //
    // This fast non-cryptographic random number generator is designed for
    // use in Monte-Carlo algorithms. It combines a long-period xorshift
    // generator with a Weyl generator, and it passes all common batteries
    // of stasticial tests for randomness while consuming only a few nanoseconds
    // for each prng generated.  For background on the generator, see Brent's
    // paper: "Some long-period random number generators using shifts and xors."
    // http://arxiv.org/pdf/1004.3115v1.pdf
    //
    // Usage:
    //
    // var xor4096 = require('xor4096');
    // random = xor4096(1);                        // Seed with int32 or string.
    // assert.equal(random(), 0.1520436450538547); // (0, 1) range, 53 bits.
    // assert.equal(random.int32(), 1806534897);   // signed int32, 32 bits.
    //
    // For nonzero numeric keys, this impelementation provides a sequence
    // identical to that by Brent's xorgens 3 implementaion in C.  This
    // implementation also provides for initalizing the generator with
    // string seeds, or for saving and restoring the state of the generator.
    //
    // On Chrome, this prng benchmarks about 2.1 times slower than
    // Javascript's built-in Math.random().

    (function(global, module, define) {

    function XorGen(seed) {
      var me = this;

      // Set up generator function.
      me.next = function() {
        var w = me.w,
            X = me.X, i = me.i, t, v;
        // Update Weyl generator.
        me.w = w = (w + 0x61c88647) | 0;
        // Update xor generator.
        v = X[(i + 34) & 127];
        t = X[i = ((i + 1) & 127)];
        v ^= v << 13;
        t ^= t << 17;
        v ^= v >>> 15;
        t ^= t >>> 12;
        // Update Xor generator array state.
        v = X[i] = v ^ t;
        me.i = i;
        // Result is the combination.
        return (v + (w ^ (w >>> 16))) | 0;
      };

      function init(me, seed) {
        var t, v, i, j, w, X = [], limit = 128;
        if (seed === (seed | 0)) {
          // Numeric seeds initialize v, which is used to generates X.
          v = seed;
          seed = null;
        } else {
          // String seeds are mixed into v and X one character at a time.
          seed = seed + '\0';
          v = 0;
          limit = Math.max(limit, seed.length);
        }
        // Initialize circular array and weyl value.
        for (i = 0, j = -32; j < limit; ++j) {
          // Put the unicode characters into the array, and shuffle them.
          if (seed) v ^= seed.charCodeAt((j + 32) % seed.length);
          // After 32 shuffles, take v as the starting w value.
          if (j === 0) w = v;
          v ^= v << 10;
          v ^= v >>> 15;
          v ^= v << 4;
          v ^= v >>> 13;
          if (j >= 0) {
            w = (w + 0x61c88647) | 0;     // Weyl.
            t = (X[j & 127] ^= (v + w));  // Combine xor and weyl to init array.
            i = (0 == t) ? i + 1 : 0;     // Count zeroes.
          }
        }
        // We have detected all zeroes; make the key nonzero.
        if (i >= 128) {
          X[(seed && seed.length || 0) & 127] = -1;
        }
        // Run the generator 512 times to further mix the state before using it.
        // Factoring this as a function slows the main generator, so it is just
        // unrolled here.  The weyl generator is not advanced while warming up.
        i = 127;
        for (j = 4 * 128; j > 0; --j) {
          v = X[(i + 34) & 127];
          t = X[i = ((i + 1) & 127)];
          v ^= v << 13;
          t ^= t << 17;
          v ^= v >>> 15;
          t ^= t >>> 12;
          X[i] = v ^ t;
        }
        // Storing state as object members is faster than using closure variables.
        me.w = w;
        me.X = X;
        me.i = i;
      }

      init(me, seed);
    }

    function copy(f, t) {
      t.i = f.i;
      t.w = f.w;
      t.X = f.X.slice();
      return t;
    }
    function impl(seed, opts) {
      if (seed == null) seed = +(new Date);
      var xg = new XorGen(seed),
          state = opts && opts.state,
          prng = function() { return (xg.next() >>> 0) / 0x100000000; };
      prng.double = function() {
        do {
          var top = xg.next() >>> 11,
              bot = (xg.next() >>> 0) / 0x100000000,
              result = (top + bot) / (1 << 21);
        } while (result === 0);
        return result;
      };
      prng.int32 = xg.next;
      prng.quick = prng;
      if (state) {
        if (state.X) copy(state, xg);
        prng.state = function() { return copy(xg, {}); };
      }
      return prng;
    }

    if (module && module.exports) {
      module.exports = impl;
    } else if (define && define.amd) {
      define(function() { return impl; });
    } else {
      this.xor4096 = impl;
    }

    })(
      commonjsGlobal,                                     // window object or global
       module,    // present in node.js
      (typeof undefined) == 'function'    // present with an AMD loader
    );
    });

    var tychei = createCommonjsModule(function (module) {
    // A Javascript implementaion of the "Tyche-i" prng algorithm by
    // Samuel Neves and Filipe Araujo.
    // See https://eden.dei.uc.pt/~sneves/pubs/2011-snfa2.pdf

    (function(global, module, define) {

    function XorGen(seed) {
      var me = this, strseed = '';

      // Set up generator function.
      me.next = function() {
        var b = me.b, c = me.c, d = me.d, a = me.a;
        b = (b << 25) ^ (b >>> 7) ^ c;
        c = (c - d) | 0;
        d = (d << 24) ^ (d >>> 8) ^ a;
        a = (a - b) | 0;
        me.b = b = (b << 20) ^ (b >>> 12) ^ c;
        me.c = c = (c - d) | 0;
        me.d = (d << 16) ^ (c >>> 16) ^ a;
        return me.a = (a - b) | 0;
      };

      /* The following is non-inverted tyche, which has better internal
       * bit diffusion, but which is about 25% slower than tyche-i in JS.
      me.next = function() {
        var a = me.a, b = me.b, c = me.c, d = me.d;
        a = (me.a + me.b | 0) >>> 0;
        d = me.d ^ a; d = d << 16 ^ d >>> 16;
        c = me.c + d | 0;
        b = me.b ^ c; b = b << 12 ^ d >>> 20;
        me.a = a = a + b | 0;
        d = d ^ a; me.d = d = d << 8 ^ d >>> 24;
        me.c = c = c + d | 0;
        b = b ^ c;
        return me.b = (b << 7 ^ b >>> 25);
      }
      */

      me.a = 0;
      me.b = 0;
      me.c = 2654435769 | 0;
      me.d = 1367130551;

      if (seed === Math.floor(seed)) {
        // Integer seed.
        me.a = (seed / 0x100000000) | 0;
        me.b = seed | 0;
      } else {
        // String seed.
        strseed += seed;
      }

      // Mix in string seed, then discard an initial batch of 64 values.
      for (var k = 0; k < strseed.length + 20; k++) {
        me.b ^= strseed.charCodeAt(k) | 0;
        me.next();
      }
    }

    function copy(f, t) {
      t.a = f.a;
      t.b = f.b;
      t.c = f.c;
      t.d = f.d;
      return t;
    }
    function impl(seed, opts) {
      var xg = new XorGen(seed),
          state = opts && opts.state,
          prng = function() { return (xg.next() >>> 0) / 0x100000000; };
      prng.double = function() {
        do {
          var top = xg.next() >>> 11,
              bot = (xg.next() >>> 0) / 0x100000000,
              result = (top + bot) / (1 << 21);
        } while (result === 0);
        return result;
      };
      prng.int32 = xg.next;
      prng.quick = prng;
      if (state) {
        if (typeof(state) == 'object') copy(state, xg);
        prng.state = function() { return copy(xg, {}); };
      }
      return prng;
    }

    if (module && module.exports) {
      module.exports = impl;
    } else if (define && define.amd) {
      define(function() { return impl; });
    } else {
      this.tychei = impl;
    }

    })(
      commonjsGlobal,
       module,    // present in node.js
      (typeof undefined) == 'function'    // present with an AMD loader
    );
    });

    var _nodeResolve_empty = {};

    var _nodeResolve_empty$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        'default': _nodeResolve_empty
    });

    var require$$0 = getCjsExportFromNamespace(_nodeResolve_empty$1);

    var seedrandom = createCommonjsModule(function (module) {
    /*
    Copyright 2019 David Bau.

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
    CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
    TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
    SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

    */

    (function (global, pool, math) {
    //
    // The following constants are related to IEEE 754 limits.
    //

    var width = 256,        // each RC4 output is 0 <= x < 256
        chunks = 6,         // at least six RC4 outputs for each double
        digits = 52,        // there are 52 significant digits in a double
        rngname = 'random', // rngname: name for Math.random and Math.seedrandom
        startdenom = math.pow(width, chunks),
        significance = math.pow(2, digits),
        overflow = significance * 2,
        mask = width - 1,
        nodecrypto;         // node.js crypto module, initialized at the bottom.

    //
    // seedrandom()
    // This is the seedrandom function described above.
    //
    function seedrandom(seed, options, callback) {
      var key = [];
      options = (options == true) ? { entropy: true } : (options || {});

      // Flatten the seed string or build one from local entropy if needed.
      var shortseed = mixkey(flatten(
        options.entropy ? [seed, tostring(pool)] :
        (seed == null) ? autoseed() : seed, 3), key);

      // Use the seed to initialize an ARC4 generator.
      var arc4 = new ARC4(key);

      // This function returns a random double in [0, 1) that contains
      // randomness in every bit of the mantissa of the IEEE 754 value.
      var prng = function() {
        var n = arc4.g(chunks),             // Start with a numerator n < 2 ^ 48
            d = startdenom,                 //   and denominator d = 2 ^ 48.
            x = 0;                          //   and no 'extra last byte'.
        while (n < significance) {          // Fill up all significant digits by
          n = (n + x) * width;              //   shifting numerator and
          d *= width;                       //   denominator and generating a
          x = arc4.g(1);                    //   new least-significant-byte.
        }
        while (n >= overflow) {             // To avoid rounding up, before adding
          n /= 2;                           //   last byte, shift everything
          d /= 2;                           //   right using integer math until
          x >>>= 1;                         //   we have exactly the desired bits.
        }
        return (n + x) / d;                 // Form the number within [0, 1).
      };

      prng.int32 = function() { return arc4.g(4) | 0; };
      prng.quick = function() { return arc4.g(4) / 0x100000000; };
      prng.double = prng;

      // Mix the randomness into accumulated entropy.
      mixkey(tostring(arc4.S), pool);

      // Calling convention: what to return as a function of prng, seed, is_math.
      return (options.pass || callback ||
          function(prng, seed, is_math_call, state) {
            if (state) {
              // Load the arc4 state from the given state if it has an S array.
              if (state.S) { copy(state, arc4); }
              // Only provide the .state method if requested via options.state.
              prng.state = function() { return copy(arc4, {}); };
            }

            // If called as a method of Math (Math.seedrandom()), mutate
            // Math.random because that is how seedrandom.js has worked since v1.0.
            if (is_math_call) { math[rngname] = prng; return seed; }

            // Otherwise, it is a newer calling convention, so return the
            // prng directly.
            else return prng;
          })(
      prng,
      shortseed,
      'global' in options ? options.global : (this == math),
      options.state);
    }

    //
    // ARC4
    //
    // An ARC4 implementation.  The constructor takes a key in the form of
    // an array of at most (width) integers that should be 0 <= x < (width).
    //
    // The g(count) method returns a pseudorandom integer that concatenates
    // the next (count) outputs from ARC4.  Its return value is a number x
    // that is in the range 0 <= x < (width ^ count).
    //
    function ARC4(key) {
      var t, keylen = key.length,
          me = this, i = 0, j = me.i = me.j = 0, s = me.S = [];

      // The empty key [] is treated as [0].
      if (!keylen) { key = [keylen++]; }

      // Set up S using the standard key scheduling algorithm.
      while (i < width) {
        s[i] = i++;
      }
      for (i = 0; i < width; i++) {
        s[i] = s[j = mask & (j + key[i % keylen] + (t = s[i]))];
        s[j] = t;
      }

      // The "g" method returns the next (count) outputs as one number.
      (me.g = function(count) {
        // Using instance members instead of closure state nearly doubles speed.
        var t, r = 0,
            i = me.i, j = me.j, s = me.S;
        while (count--) {
          t = s[i = mask & (i + 1)];
          r = r * width + s[mask & ((s[i] = s[j = mask & (j + t)]) + (s[j] = t))];
        }
        me.i = i; me.j = j;
        return r;
        // For robust unpredictability, the function call below automatically
        // discards an initial batch of values.  This is called RC4-drop[256].
        // See http://google.com/search?q=rsa+fluhrer+response&btnI
      })(width);
    }

    //
    // copy()
    // Copies internal state of ARC4 to or from a plain object.
    //
    function copy(f, t) {
      t.i = f.i;
      t.j = f.j;
      t.S = f.S.slice();
      return t;
    }
    //
    // flatten()
    // Converts an object tree to nested arrays of strings.
    //
    function flatten(obj, depth) {
      var result = [], typ = (typeof obj), prop;
      if (depth && typ == 'object') {
        for (prop in obj) {
          try { result.push(flatten(obj[prop], depth - 1)); } catch (e) {}
        }
      }
      return (result.length ? result : typ == 'string' ? obj : obj + '\0');
    }

    //
    // mixkey()
    // Mixes a string seed into a key that is an array of integers, and
    // returns a shortened string seed that is equivalent to the result key.
    //
    function mixkey(seed, key) {
      var stringseed = seed + '', smear, j = 0;
      while (j < stringseed.length) {
        key[mask & j] =
          mask & ((smear ^= key[mask & j] * 19) + stringseed.charCodeAt(j++));
      }
      return tostring(key);
    }

    //
    // autoseed()
    // Returns an object for autoseeding, using window.crypto and Node crypto
    // module if available.
    //
    function autoseed() {
      try {
        var out;
        if (nodecrypto && (out = nodecrypto.randomBytes)) {
          // The use of 'out' to remember randomBytes makes tight minified code.
          out = out(width);
        } else {
          out = new Uint8Array(width);
          (global.crypto || global.msCrypto).getRandomValues(out);
        }
        return tostring(out);
      } catch (e) {
        var browser = global.navigator,
            plugins = browser && browser.plugins;
        return [+new Date, global, plugins, global.screen, tostring(pool)];
      }
    }

    //
    // tostring()
    // Converts an array of charcodes to a string
    //
    function tostring(a) {
      return String.fromCharCode.apply(0, a);
    }

    //
    // When seedrandom.js is loaded, we immediately mix a few bits
    // from the built-in RNG into the entropy pool.  Because we do
    // not want to interfere with deterministic PRNG state later,
    // seedrandom will not call math.random on its own again after
    // initialization.
    //
    mixkey(math.random(), pool);

    //
    // Nodejs and AMD support: export the implementation as a module using
    // either convention.
    //
    if ( module.exports) {
      module.exports = seedrandom;
      // When in node.js, try using crypto package for autoseeding.
      try {
        nodecrypto = require$$0;
      } catch (ex) {}
    } else {
      // When included as a plain script, set up Math.seedrandom global.
      math['seed' + rngname] = seedrandom;
    }


    // End anonymous scope, and pass initial values.
    })(
      // global: `self` in browsers (including strict mode and web workers),
      // otherwise `this` in Node and other environments
      (typeof self !== 'undefined') ? self : commonjsGlobal,
      [],     // pool: entropy pool starts empty
      Math    // math: package containing random, pow, and seedrandom
    );
    });

    // A library of seedable RNGs implemented in Javascript.
    //
    // Usage:
    //
    // var seedrandom = require('seedrandom');
    // var random = seedrandom(1); // or any seed.
    // var x = random();       // 0 <= x < 1.  Every bit is random.
    // var x = random.quick(); // 0 <= x < 1.  32 bits of randomness.

    // alea, a 53-bit multiply-with-carry generator by Johannes Baagøe.
    // Period: ~2^116
    // Reported to pass all BigCrush tests.


    // xor128, a pure xor-shift generator by George Marsaglia.
    // Period: 2^128-1.
    // Reported to fail: MatrixRank and LinearComp.


    // xorwow, George Marsaglia's 160-bit xor-shift combined plus weyl.
    // Period: 2^192-2^32
    // Reported to fail: CollisionOver, SimpPoker, and LinearComp.


    // xorshift7, by François Panneton and Pierre L'ecuyer, takes
    // a different approach: it adds robustness by allowing more shifts
    // than Marsaglia's original three.  It is a 7-shift generator
    // with 256 bits, that passes BigCrush with no systmatic failures.
    // Period 2^256-1.
    // No systematic BigCrush failures reported.


    // xor4096, by Richard Brent, is a 4096-bit xor-shift with a
    // very long period that also adds a Weyl generator. It also passes
    // BigCrush with no systematic failures.  Its long period may
    // be useful if you have many generators and need to avoid
    // collisions.
    // Period: 2^4128-2^32.
    // No systematic BigCrush failures reported.


    // Tyche-i, by Samuel Neves and Filipe Araujo, is a bit-shifting random
    // number generator derived from ChaCha, a modern stream cipher.
    // https://eden.dei.uc.pt/~sneves/pubs/2011-snfa2.pdf
    // Period: ~2^127
    // No systematic BigCrush failures reported.


    // The original ARC4-based prng included in this library.
    // Period: ~2^1600


    seedrandom.alea = alea;
    seedrandom.xor128 = xor128;
    seedrandom.xorwow = xorwow;
    seedrandom.xorshift7 = xorshift7;
    seedrandom.xor4096 = xor4096;
    seedrandom.tychei = tychei;

    var seedrandom$1 = seedrandom;

    /**
     * Returns a hashed string as hex values
     * @param {string} seed - String to hash
     */
    function generate_hash(seed) {
        // source: https://github.com/darkskyapp/string-hash
        var index = seed.length;
        var hash = 5381;
        while (index) {
            hash = (hash * 33) ^ seed.charCodeAt(--index);
        }
        return (hash >>> 0).toString(16);
    }

    /**
     * Represents if the code is being ran in a Browser
     */
    var IS_BROWSER = typeof window === "object";

    /**
     * Represents a wrapper class for ease-of-use handling of an image `Blob` instance
     */
    var ImageBlob = /** @class */ (function () {
        /**
         * Constructor for `ImageBlob`
         */
        function ImageBlob(data, generator) {
            this.data = data;
            this.generator = generator;
        }
        /**
         * Returns the current raw image data encoded with the given `Encoder` instance
         */
        ImageBlob.prototype.encode_image_data = function () {
            return __awaiter(this, void 0, void 0, function () {
                var _a, data, generator, _b, height, width, encoder, encoded_data;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            _a = this, data = _a.data, generator = _a.generator;
                            _b = generator.options, height = _b.height, width = _b.width;
                            encoder = generator.options.get_encoder();
                            return [4 /*yield*/, encoder.encode(data, height, width)];
                        case 1:
                            encoded_data = _c.sent();
                            return [2 /*return*/, [encoded_data, encoder.mime_type]];
                    }
                });
            });
        };
        /**
         * Returns a URL and callback on both Browser and NodeJS runtimes, called `ImageBlob.create_object_url` on Browsers `ImageBlob.create_data_uri` on NodeJS
         */
        ImageBlob.prototype.create_isomorphic_url = function () {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (!IS_BROWSER) return [3 /*break*/, 2];
                            return [4 /*yield*/, this.create_object_url()];
                        case 1: return [2 /*return*/, _a.sent()];
                        case 2: return [2 /*return*/, this.create_data_uri()];
                    }
                });
            });
        };
        /**
         * Returns a Data URI with the encoded image data as Base64
         */
        ImageBlob.prototype.create_data_uri = function () {
            return __awaiter(this, void 0, void 0, function () {
                var _a, data, mime_type, base64_data;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0: return [4 /*yield*/, this.encode_image_data()];
                        case 1:
                            _a = _b.sent(), data = _a[0], mime_type = _a[1];
                            base64_data = btoa(data.join());
                            return [2 /*return*/, ["data:" + mime_type + ";base64," + base64_data, function () { return undefined; }]];
                    }
                });
            });
        };
        /**
         * Returns an Object URL created with `URL.createObjectURL`, along with a deconstructor callback
         */
        ImageBlob.prototype.create_object_url = function () {
            return __awaiter(this, void 0, void 0, function () {
                var _a, data, mime_type, blob, url, callback;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0: return [4 /*yield*/, this.encode_image_data()];
                        case 1:
                            _a = _b.sent(), data = _a[0], mime_type = _a[1];
                            blob = new Blob([data], { type: mime_type });
                            url = URL.createObjectURL(blob);
                            callback = function () {
                                if (!url) {
                                    throw new Error("bad dispatch to 'ImageBlob.create_object_url.callback' (URL already deconstructed)");
                                }
                                URL.revokeObjectURL(url);
                                url = "";
                            };
                            return [2 /*return*/, [url, callback]];
                    }
                });
            });
        };
        return ImageBlob;
    }());
    /**
     * Represents the normalized options passed into `Generator`
     */
    var GeneratorOptions = /** @class */ (function () {
        /**
         * Constructor for `GeneratorOptions`
         * @param options -
         */
        function GeneratorOptions(options) {
            if (options === void 0) { options = {}; }
            this.encoder = undefined;
            this.hash = "";
            this.height = 256;
            this.seed = "";
            this.width = 256;
            // If the end-developer provided a `.seed` option and no hash,
            // we should automatically hash their seed for them
            if (options.seed && !options.hash)
                options.hash = generate_hash(options.seed);
            Object.assign(this, options);
        }
        /**
         * Returns an `Encoder` instanced passed into `Generator`
         */
        GeneratorOptions.prototype.get_encoder = function () {
            if (this.encoder)
                return this.encoder;
            throw new Error("bad dispatch to 'GeneratorOptions.get_encoder' (encoder not provided)");
        };
        return GeneratorOptions;
    }());
    /**
     * Represents the base for all image generators
     */
    var Generator = /** @class */ (function () {
        /**
         * Constructor for `Generator`
         * @param options -
         */
        function Generator(options, Options) {
            if (options === void 0) { options = {}; }
            if (Options === void 0) { Options = GeneratorOptions; }
            this.options = new Options(options);
        }
        /**
         * Makes and seeds a new RNG generator
         * @param seed - String to seed with
         */
        Generator.prototype.create_generator = function (seed) {
            this.generator = seedrandom$1(seed);
        };
        /**
         * Returns the next value in the RNG generator
         */
        Generator.prototype.next = function () {
            if (!this.generator) {
                throw new Error("bad dispatch to 'Generator.next' (RNG not seeded)");
            }
            return this.generator();
        };
        /**
         * Returns the rendered `ImageBlob` for the current RNG step
         */
        Generator.prototype.render_blob = function () {
            return __awaiter(this, void 0, void 0, function () {
                var data;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.render()];
                        case 1:
                            data = _a.sent();
                            return [2 /*return*/, new ImageBlob(data, this)];
                    }
                });
            });
        };
        /**
         * Returns the rendered binary data for the current RNG step
         */
        Generator.prototype.render = function () {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    throw new Error("bad dispatch to 'Generator.render' (not implemented)");
                });
            });
        };
        return Generator;
    }());

    /**
     * Returns an array of N number of RGB colors, based off hashing the `seed` value
     * @param {String} seed - String to start hashing with
     * @param {Number} max_colors - Amount of colors to generate
     */
    function generate_hashed_colors(seed, max_colors) {
        // source: https://github.com/saveryanov/avatars/blob/master/index.js#L48-L64
        var colors = new Array(max_colors);
        var hash = generate_hash(seed);
        for (var i = 0; i < max_colors; i++) {
            var sliceInd = i % 5; // 32 chars in hash, 6 chars per color
            var offset = sliceInd * 6;
            colors[i] = [
                parseInt(hash[offset + 0] + hash[offset + 1], 16),
                parseInt(hash[offset + 2] + hash[offset + 3], 16),
                parseInt(hash[offset + 4] + hash[offset + 5], 16) // blue
            ];
            if (sliceInd == 0 && i != 0) {
                hash = generate_hash(hash);
            }
        }
        return colors;
    }

    /**
     * Modified from:
     *  - https://github.com/MonoMisch/random-jpeg
     */
    function compare_numbers(a, b) {
        return a - b;
    }
    function create_buffer(selectedColors, xs, ys) {
        var width = xs[xs.length - 1];
        var height = ys[ys.length - 1];
        var fieldsPerPixel = 4;
        var buffer = new Uint8Array(width * height * fieldsPerPixel);
        var bufferPos = 0;
        var currentTile = 0;
        for (var i = 0; i < ys.length - 1; i++) {
            for (var currentY = ys[i]; currentY < ys[i + 1]; currentY++) {
                currentTile = i * (xs.length - 1);
                for (var k = 0; k < xs.length - 1; k++) {
                    for (var currentX = xs[k]; currentX < xs[k + 1]; currentX++) {
                        buffer[bufferPos++] = selectedColors[currentTile][0]; // red
                        buffer[bufferPos++] = selectedColors[currentTile][1]; // green
                        buffer[bufferPos++] = selectedColors[currentTile][2]; // blue
                        buffer[bufferPos++] = 0xff; // alpha
                    }
                    currentTile++;
                }
            }
        }
        return buffer;
    }
    /**
     * Represents all the normalized options that can be passed into `ColumnsGenerator`
     */
    var ColumnsGeneratorOptions = /** @class */ (function (_super) {
        __extends(ColumnsGeneratorOptions, _super);
        /**
         * Constructor for `ColumnsGeneratorOptions`
         */
        function ColumnsGeneratorOptions(options) {
            if (options === void 0) { options = {}; }
            var _this = _super.call(this, options) || this;
            _this.colors = [];
            _this.color_touch = false;
            _this.columns = 5;
            _this.max_colors = 3;
            _this.rows = 5;
            var colors = options.colors
                ? options.colors
                : generate_hashed_colors(_this.hash, _this.max_colors);
            _this.colors = colors;
            return _this;
        }
        return ColumnsGeneratorOptions;
    }(GeneratorOptions));
    /**
     * Represents the a generator for rendering random "blochy" columns and rows
     */
    var ColumnsGenerator = /** @class */ (function (_super) {
        __extends(ColumnsGenerator, _super);
        /**
         * Constructor for `ColumnsGenerator`
         * @param {IColumnsGeneratorOptions} options
         */
        function ColumnsGenerator(options) {
            if (options === void 0) { options = {}; }
            var _this = _super.call(this, options, ColumnsGeneratorOptions) || this;
            // @ts-ignore
            _this.create_generator(_this.options.seed);
            return _this;
        }
        /**
         * Returns the rendered JPEG binary data for the current RNG increment
         */
        ColumnsGenerator.prototype.render = function () {
            return __awaiter(this, void 0, void 0, function () {
                var _a, columns, height, rows, width, color_array, x_grid, y_grid;
                return __generator(this, function (_b) {
                    _a = this.options, columns = _a.columns, height = _a.height, rows = _a.rows, width = _a.width;
                    color_array = this.generate_extended_color_array();
                    x_grid = this.generate_dim_array(width, columns);
                    y_grid = this.generate_dim_array(height, rows);
                    return [2 /*return*/, create_buffer(color_array, x_grid, y_grid)];
                });
            });
        };
        ColumnsGenerator.prototype.generate_dim_array = function (dimlenght, nrOfTilesInDim) {
            var result = [0];
            result.push(dimlenght);
            for (var i = 0; i < nrOfTilesInDim - 1; i++) {
                result.push(Math.floor(this.next() * dimlenght));
            }
            return result.sort(compare_numbers);
        };
        ColumnsGenerator.prototype.generate_extended_color_array = function () {
            var _a = this.options, colors = _a.colors, color_touch = _a.color_touch, columns = _a.columns, rows = _a.rows;
            var extColors = [];
            var nrOfTiles = columns * rows;
            var index;
            if (color_touch) {
                for (var i = 0; i < nrOfTiles; i++) {
                    index = Math.floor(this.next() * colors.length);
                    extColors.push(colors[index]);
                }
            }
            else {
                var indexTileLeft = -667;
                var columnPos = void 0;
                var indicesTilesRowAbove = new Array(columns);
                while (extColors.length < nrOfTiles) {
                    columnPos = extColors.length % columns;
                    index = Math.floor(this.next() * colors.length);
                    if (index != indexTileLeft && index != indicesTilesRowAbove[columnPos]) {
                        indexTileLeft = index;
                        indicesTilesRowAbove[columnPos] = index;
                        extColors.push(colors[index]);
                    }
                }
            }
            return extColors;
        };
        return ColumnsGenerator;
    }(Generator));

    /**
     * Represents each type of image encoding available to `RandomImage`
     */
    const IMAGE_ENCODERS = {
        jpg: JPEGEncoder$1,
        jpeg: JPEGEncoder$1
    };

    /**
     * Represents each type of generator available to `RandomImage`
     */
    const IMAGE_GENERATORS = {
        columns: ColumnsGenerator
    };

    /**
     * Represents the keys available in `IMAGE_ENCODERS`
     */
    const IMAGE_ENCODER_KEYS = Object.keys(IMAGE_ENCODERS);

    /**
     * Represents the keys available in `IMAGE_GENERATORS`
     */
    const IMAGE_GENERATOR_KEYS = Object.keys(IMAGE_GENERATORS);

    /**
     * Returns the specified `Encoder`, throwing a "nice" error if not found
     */
    function get_encoder(encoder_name) {
        const encoder = IMAGE_ENCODER[encoder_name];
        if (encoder) return encoder;

        throw new Error(`bad dispatch to 'get_encoder' (invalid encoder '${encoder_name}')`);
    }

    /**
     * Returns the specified `Generator`, throwing a "nice" error if not found
     */
    function get_generator(generator_name) {
        const generator = IMAGE_GENERATORS[generator_name];
        if (generator) return generator;

        throw new Error(`bad dispatch to 'get_generator' (invalid generator '${generator_name}')`);
    }

    /* src/components/RandomImage.svelte generated by Svelte v3.12.1 */

    // (72:0) {:catch err}
    function create_catch_block(ctx) {
    	var t;

    	return {
    		c() {
    			t = text("ERROR RENDERING IMAGE");
    		},

    		m(target, anchor) {
    			insert(target, t, anchor);
    		},

    		p: noop,

    		d(detaching) {
    			if (detaching) {
    				detach(t);
    			}
    		}
    	};
    }

    // (69:0) {:then _}
    function create_then_block(ctx) {
    	var img, img_style_value;

    	return {
    		c() {
    			img = element("img");
    			attr(img, "alt", ctx.alt);
    			attr(img, "src", ctx.src);
    			attr(img, "title", ctx.title);
    			attr(img, "class", ctx._class);
    			attr(img, "style", img_style_value = "height:" + ctx.height + "px;width:" + ctx.width + "px;" + ctx.style);
    		},

    		m(target, anchor) {
    			insert(target, img, anchor);
    		},

    		p(changed, ctx) {
    			if (changed.alt) {
    				attr(img, "alt", ctx.alt);
    			}

    			if (changed.src) {
    				attr(img, "src", ctx.src);
    			}

    			if (changed.title) {
    				attr(img, "title", ctx.title);
    			}

    			if (changed._class) {
    				attr(img, "class", ctx._class);
    			}

    			if ((changed.height || changed.width || changed.style) && img_style_value !== (img_style_value = "height:" + ctx.height + "px;width:" + ctx.width + "px;" + ctx.style)) {
    				attr(img, "style", img_style_value);
    			}
    		},

    		d(detaching) {
    			if (detaching) {
    				detach(img);
    			}
    		}
    	};
    }

    // (66:16)      <div {alt}
    function create_pending_block(ctx) {
    	var div, div_style_value;

    	return {
    		c() {
    			div = element("div");
    			attr(div, "alt", ctx.alt);
    			attr(div, "title", ctx.title);
    			attr(div, "class", ctx._class);
    			attr(div, "style", div_style_value = "height:" + ctx.height + "px;width:" + ctx.width + "px;" + ctx.style);
    		},

    		m(target, anchor) {
    			insert(target, div, anchor);
    		},

    		p(changed, ctx) {
    			if (changed.alt) {
    				attr(div, "alt", ctx.alt);
    			}

    			if (changed.title) {
    				attr(div, "title", ctx.title);
    			}

    			if (changed._class) {
    				attr(div, "class", ctx._class);
    			}

    			if ((changed.height || changed.width || changed.style) && div_style_value !== (div_style_value = "height:" + ctx.height + "px;width:" + ctx.width + "px;" + ctx.style)) {
    				attr(div, "style", div_style_value);
    			}
    		},

    		d(detaching) {
    			if (detaching) {
    				detach(div);
    			}
    		}
    	};
    }

    function create_fragment(ctx) {
    	var await_block_anchor, promise_1;

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: '_',
    		error: 'err'
    	};

    	handle_promise(promise_1 = ctx.promise, info);

    	return {
    		c() {
    			await_block_anchor = empty();

    			info.block.c();
    		},

    		m(target, anchor) {
    			insert(target, await_block_anchor, anchor);

    			info.block.m(target, info.anchor = anchor);
    			info.mount = () => await_block_anchor.parentNode;
    			info.anchor = await_block_anchor;
    		},

    		p(changed, new_ctx) {
    			ctx = new_ctx;
    			info.ctx = ctx;

    			if (('promise' in changed) && promise_1 !== (promise_1 = ctx.promise) && handle_promise(promise_1, info)) ; else {
    				info.block.p(changed, assign(assign({}, ctx), info.resolved));
    			}
    		},

    		i: noop,
    		o: noop,

    		d(detaching) {
    			if (detaching) {
    				detach(await_block_anchor);
    			}

    			info.block.d(detaching);
    			info.token = null;
    			info = null;
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let callback = null;
        let promise = null;
        let src = "";

        let { class: _class = "", encoder = "jpeg", generator = "columns", colors = undefined, color_touch = false, columns = 5, hash = "", height = 256, max_colors = 3, rows = 5, seed = "", width = 256, alt = "", style = "", title = "" } = $$props;

        async function render_image() {
            const _encoder = new Encoder({quality: 100});
            const _generator = new Generator(options);

            const image_blob = await _generator.render_blob();

            return image_blob.encode_image_data();
        }

    	$$self.$set = $$props => {
    		if ('class' in $$props) $$invalidate('_class', _class = $$props.class);
    		if ('encoder' in $$props) $$invalidate('encoder', encoder = $$props.encoder);
    		if ('generator' in $$props) $$invalidate('generator', generator = $$props.generator);
    		if ('colors' in $$props) $$invalidate('colors', colors = $$props.colors);
    		if ('color_touch' in $$props) $$invalidate('color_touch', color_touch = $$props.color_touch);
    		if ('columns' in $$props) $$invalidate('columns', columns = $$props.columns);
    		if ('hash' in $$props) $$invalidate('hash', hash = $$props.hash);
    		if ('height' in $$props) $$invalidate('height', height = $$props.height);
    		if ('max_colors' in $$props) $$invalidate('max_colors', max_colors = $$props.max_colors);
    		if ('rows' in $$props) $$invalidate('rows', rows = $$props.rows);
    		if ('seed' in $$props) $$invalidate('seed', seed = $$props.seed);
    		if ('width' in $$props) $$invalidate('width', width = $$props.width);
    		if ('alt' in $$props) $$invalidate('alt', alt = $$props.alt);
    		if ('style' in $$props) $$invalidate('style', style = $$props.style);
    		if ('title' in $$props) $$invalidate('title', title = $$props.title);
    	};

    	let options, Encoder, Generator;

    	$$self.$$.update = ($$dirty = { colors: 1, color_touch: 1, columns: 1, hash: 1, height: 1, max_colors: 1, rows: 1, seed: 1, width: 1, encoder: 1, generator: 1, callback: 1, promise: 1 }) => {
    		if ($$dirty.colors || $$dirty.color_touch || $$dirty.columns || $$dirty.hash || $$dirty.height || $$dirty.max_colors || $$dirty.rows || $$dirty.seed || $$dirty.width) { options = {colors, color_touch, columns, hash, height, max_colors, rows, seed, width}; }
    		if ($$dirty.encoder) { Encoder = get_encoder(encoder); }
    		if ($$dirty.generator) { Generator = get_generator(generator); }
    		if ($$dirty.callback || $$dirty.promise) { {
                    if (typeof window !== "undefined") {
                        if (callback) {
                            callback();
                            $$invalidate('callback', callback = null);
                        }
            
                        // Render the current configuration into a Promise for reactivity,
                        // and locally cache it
                        $$invalidate('promise', promise = render_image());
                        const _promise = promise;
            
                        promise.then((render_data) => {
                            // Sanity check that the current Component state `.promise` is our same `_promise`,
                            // before assigning into Component state. Otherwise, deconstruct this encoded image
                            if (promise === _promise) {
                                // We could get `.src` within the `#await` block, but we need to retrieve
                                // `.callback` anyway
                                $$invalidate('src', [src, callback] = render_data, src, $$invalidate('callback', callback), $$invalidate('promise', promise));
                            } else render_data[1]();
                        });
                    }
                } }
    	};

    	return {
    		promise,
    		src,
    		_class,
    		encoder,
    		generator,
    		colors,
    		color_touch,
    		columns,
    		hash,
    		height,
    		max_colors,
    		rows,
    		seed,
    		width,
    		alt,
    		style,
    		title
    	};
    }

    class RandomImage extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, ["class", "encoder", "generator", "colors", "color_touch", "columns", "hash", "height", "max_colors", "rows", "seed", "width", "alt", "style", "title"]);
    	}
    }

    exports.IMAGE_ENCODERS = IMAGE_ENCODERS;
    exports.IMAGE_ENCODER_KEYS = IMAGE_ENCODER_KEYS;
    exports.IMAGE_GENERATORS = IMAGE_GENERATORS;
    exports.IMAGE_GENERATOR_KEYS = IMAGE_GENERATOR_KEYS;
    exports.RandomImage = RandomImage;
    exports.get_encoder = get_encoder;
    exports.get_generator = get_generator;

    Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=svelte-random-image.umd.js.map
