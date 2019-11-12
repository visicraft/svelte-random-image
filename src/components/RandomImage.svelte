<script>
    import {get_encoder, get_generator} from "../util/constants";

    let callback = null;
    let promise = null;
    let src = "";

    let _class = "";

    export let encoder = "jpeg";
    export let generator = "columns";

    export let colors = undefined;
    export let color_touch = false;
    export let columns = 5;
    export let hash = "";
    export let height = 256;
    export let max_colors = 3;
    export let rows = 5;
    export let seed = "";
    export let server = false;
    export let width = 256;

    export let alt = "";
    export let style = "";
    export let title = "";
    export {_class as class};

    async function render_image() {
        const _encoder = new Encoder({quality: 100});
        const _generator = new Generator({...options, encoder: _encoder});

        const image_blob = await _generator.render_blob();

        return image_blob.create_isomorphic_url();
    }

    $: options = {colors, color_touch, columns, hash, height, max_colors, rows, seed, width};
    $: Encoder = get_encoder(encoder);
    $: Generator = get_generator(generator);

    $: {
        if (typeof window !== "undefined" || server) {
            if (callback) {
                callback();
                callback = null;
            }

            // Render the current configuration into a Promise for reactivity,
            // and locally cache it
            promise = render_image();
            const _promise = promise;

            promise.then((render_data) => {
                // Sanity check that the current Component state `.promise` is our same `_promise`,
                // before assigning into Component state. Otherwise, deconstruct this encoded image
                if (promise === _promise) {
                    // We could get `.src` within the `#await` block, but we need to retrieve
                    // `.callback` anyway
                    [src, callback] = render_data;
                } else render_data[1]();
            });
        }
    }
</script>

{#await promise}
    <div {alt} {title} class={_class} style="height:{height}px;width:{width}px;{style}" />

{:then _}
    <img {alt} {src} {title} class={_class} style="height:{height}px;width:{width}px;{style}" />

{:catch err}
    ERROR RENDERING IMAGE
{/await}
