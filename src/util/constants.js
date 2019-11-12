import {ColumnsGenerator, JPEGEncoder} from "random-image";

/**
 * Represents each type of image encoding available to `RandomImage`
 */
export const IMAGE_ENCODERS = {
    jpg: JPEGEncoder,
    jpeg: JPEGEncoder
};

/**
 * Represents each type of generator available to `RandomImage`
 */
export const IMAGE_GENERATORS = {
    columns: ColumnsGenerator
};

/**
 * Represents the keys available in `IMAGE_ENCODERS`
 */
export const IMAGE_ENCODER_KEYS = Object.keys(IMAGE_ENCODERS);

/**
 * Represents the keys available in `IMAGE_GENERATORS`
 */
export const IMAGE_GENERATOR_KEYS = Object.keys(IMAGE_GENERATORS);

/**
 * Returns the specified `Encoder`, throwing a "nice" error if not found
 */
export function get_encoder(encoder_name) {
    const encoder = IMAGE_ENCODERS[encoder_name];
    if (encoder) return encoder;

    throw new Error(`bad dispatch to 'get_encoder' (invalid encoder '${encoder_name}')`);
}

/**
 * Returns the specified `Generator`, throwing a "nice" error if not found
 */
export function get_generator(generator_name) {
    const generator = IMAGE_GENERATORS[generator_name];
    if (generator) return generator;

    throw new Error(`bad dispatch to 'get_generator' (invalid generator '${generator_name}')`);
}
