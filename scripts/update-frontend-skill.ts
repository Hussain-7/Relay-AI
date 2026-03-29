/**
 * Push a new version of the frontend-design skill.
 * Run with: npx tsx scripts/update-frontend-skill.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ID = "skill_01DZPZQDf4bdLePG81PVsfRq";

async function main() {
  const _client = new Anthropic();

  const skillContent = `---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Output

Write the final HTML file using Node.js fs module. The file MUST be written using \`fs.writeFileSync\` so the code execution sandbox captures it as an output file:

\`\`\`javascript
const fs = require('fs');
const html = \\\`<!DOCTYPE html>...your HTML here...\\\`;
fs.writeFileSync('output.html', html);
console.log('Done — file written:', html.length, 'chars');
\`\`\`

CRITICAL: Always use JavaScript (not Python) to write output files. Use \`fs.writeFileSync\` — this is what ensures the file appears as a downloadable output. Do NOT use Python's \`open()\` or \`os.environ['OUTPUT_DIR']\` — those do not produce downloadable file outputs.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail
- Self-contained in a single HTML file (inline CSS and JS)

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Use Google Fonts via CDN link. Avoid generic fonts like Arial and Inter.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents.
- **Motion**: Use animations for effects and micro-interactions. CSS-only solutions preferred. Staggered reveals, scroll-triggering, and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements.
- **Backgrounds & Visual Details**: Create atmosphere and depth. Gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows.

NEVER use generic AI aesthetics: overused fonts (Inter, Roboto, Arial), cliched purple gradients on white, predictable layouts.

Vary between light and dark themes, different fonts, different aesthetics across generations. NEVER converge on common choices.

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code. Minimalist designs need restraint and precision.`;

  // Write SKILL.md to a temp directory named after the skill
  const tmpDir = path.join(__dirname, "../.tmp-skill");
  fs.mkdirSync(tmpDir, { recursive: true });
  const skillPath = path.join(tmpDir, "SKILL.md");
  fs.writeFileSync(skillPath, skillContent);

  console.log("Pushing new version to skill", SKILL_ID, "...");

  // Use raw fetch to control multipart form exactly
  const formData = new FormData();
  const fileContent = fs.readFileSync(skillPath);
  formData.append("files[]", new File([fileContent], "frontend-design/SKILL.md", { type: "text/markdown" }));

  const resp = await fetch(`https://api.anthropic.com/v1/skills/${SKILL_ID}/versions?beta=true`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "skills-2025-10-02",
    },
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${resp.status}: ${err}`);
  }

  const version = await resp.json();

  console.log("New version created!");
  console.log("Version:", JSON.stringify(version, null, 2));

  fs.rmSync(path.join(__dirname, "../.tmp-skill"), { recursive: true });
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
