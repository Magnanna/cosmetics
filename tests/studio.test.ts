import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { studioShot, STUDIO_SIZE } from "../src/lib/studio";
import { resultUrl, taskState } from "../src/lib/magnific";

test("studio shot: square, product centred on the brand backdrop", async () => {
  const cut = await sharp({ create: { width: 400, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect x="100" y="100" width="200" height="600" fill="#222"/></svg>') }])
    .png().toBuffer();
  const out = await studioShot(cut, "#5A2132");
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, STUDIO_SIZE);
  assert.equal(info.height, STUDIO_SIZE);
  const px = (x: number, y: number) => data[(y * info.width + x) * info.channels];
  assert.ok(px(STUDIO_SIZE / 2, STUDIO_SIZE / 2) < 80, "product in the middle");
  assert.ok(px(20, 20) > 200, "light backdrop in the corner");
});

test("Magnific response parsing handles both shapes", () => {
  assert.equal(resultUrl({ output_url: "a" }), "a");
  assert.equal(resultUrl({ data: { generated: ["b"] } }), "b");
  assert.equal(resultUrl({ data: { images: [{ url: "c" }] } }), "c");
  assert.deepEqual(taskState({ data: { task_id: "t", status: "completed" } }), { id: "t", status: "COMPLETED" });
});
