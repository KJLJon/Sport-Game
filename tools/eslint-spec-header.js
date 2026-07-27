/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule + traceability report generator
 * @story   —
 * @design  CLAUDE.md §6
 * @invariant INV-15
 *
 * Purpose: the editor half of INV-15 — a fast presence check on the five mandatory fields, with
 * no filesystem access, so it runs on every keystroke. Resolving task and story IDs against `03`
 * and `02` is the authoritative half and lives in `tests/invariants/inv-15-spec-headers.test.ts`,
 * which CI runs. Deliberately two checks: one that is instant, one that is complete.
 *
 * Plain JavaScript because `eslint.config.js` imports it directly, with no TypeScript loader.
 */

const REQUIRED = [
  { tag: '@spec', pattern: /@spec\s+\S/ },
  { tag: '@phase', pattern: /@phase\s+\S/ },
  { tag: '@task', pattern: /@task\s+\S/ },
  { tag: '@story', pattern: /@story\s+\S/ },
  { tag: 'Purpose:', pattern: /Purpose:\s*\S/ },
];

/** @type {import('eslint').Rule.RuleModule} */
const specHeader = {
  meta: {
    type: 'problem',
    docs: {
      description: 'every src/ module opens with a spec header (CLAUDE.md §6, INV-15)',
    },
    schema: [],
    messages: {
      missing: 'INV-15: this module has no spec header. See CLAUDE.md §6.',
      incomplete: 'INV-15: the spec header is missing {{tag}}. See CLAUDE.md §6.',
    },
  },

  create(context) {
    return {
      Program(node) {
        const source = context.sourceCode ?? context.getSourceCode();
        const [first] = source.getAllComments();

        const isLeadingBlock = first !== undefined && first.type === 'Block' && first.range[0] <= 4;

        if (!isLeadingBlock) {
          context.report({ node, messageId: 'missing' });
          return;
        }

        for (const { tag, pattern } of REQUIRED) {
          if (!pattern.test(first.value)) {
            context.report({ node: first, messageId: 'incomplete', data: { tag } });
          }
        }
      },
    };
  },
};

export default {
  rules: { 'spec-header': specHeader },
};
