// D1's batch for the node:sqlite stand-ins of an OnboardDb: the statements
// run in order as one transaction, both or neither, as D1 runs them. The
// statements run synchronously, so two batches never interleave.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { OnboardDb } from "../../lib/flightdeck/onboard-route";

export function withD1Batch(sqlite: DatabaseSync, db: OnboardDb): OnboardDb {
  const bound = new WeakMap<object, { sql: string; args: SQLInputValue[] }>();
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...values) {
          const b = statement.bind(...values);
          bound.set(b, { sql, args: values as SQLInputValue[] });
          return b;
        },
      };
    },
    async batch(statements) {
      const plan = statements.map((s) => {
        const found = bound.get(s);
        if (!found) throw new Error("batch: a statement of another database");
        return found;
      });
      sqlite.exec("BEGIN");
      try {
        const out = plan.map(({ sql, args }) => ({
          meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) },
        }));
        sqlite.exec("COMMIT");
        return out;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
