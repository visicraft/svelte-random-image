const {writeFileSync} = require("fs");

const {draw_jpeg} = require("../dist/vue-image-gen.umd");

const image_data = draw_jpeg({
    allowSameColorTouch: false,
    columns: 3,
    rows: 3,
    quality: 100,

    color_amount: 3,
    height: 128,
    width: 128,
    seed: "1-night-elves"
});

writeFileSync("sample.jpg", image_data.data);
