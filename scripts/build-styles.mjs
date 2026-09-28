import postcss from "postcss";
import tailwind from "tailwindcss";
import rtl from "tailwindcss-vanilla-rtl";
import { readFile, writeFile } from "node:fs/promises";
export async function buildStyles() {
  const upstream = await Promise.all(
    ["base", "globals"].map((name) =>
      readFile(`vendor/giscus/reference/styles/${name}.css`, "utf8"),
    ),
  );
  const source =
    "@tailwind base;\n@tailwind components;\n" +
    upstream.join("\n") +
    "\n@tailwind utilities;\n" +
    (await readFile("src/browser/standard/styles.css", "utf8"));
  const result = await postcss([
    tailwind({
      content: [
        "src/browser/standard/**/*.ts",
        "src/browser/markdown.ts",
        "vendor/giscus/reference/components/*.tsx",
      ],
      plugins: [rtl],
      corePlugins: { ...rtl.disabledCorePlugins },
    }),
  ]).process(source, { from: "src/browser/standard/styles.css" });
  const sheet = postcss.parse(result.css);
  await writeFile("public/widget.css", sheet.toString());
}
