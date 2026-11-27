import styles from "./setup-required.module.css";

interface SetupRequiredProps {
  as?: "main" | "div";
  description: string;
  missingEnv: string[];
  title: string;
}

export function SetupRequired({ as: Container = "div", description, missingEnv, title }: SetupRequiredProps) {
  return (
    <Container className={["jardin-ui", styles.page].join(" ")}>
      <section className={styles.notice}>
        <p className={styles.eyebrow}>Local setup required</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>

        <div className={styles.variables}>
          <h2>Missing environment variables</h2>
          <ul>
            {missingEnv.map((key) => (
              <li key={key}><code>{key}</code></li>
            ))}
          </ul>
        </div>

        <p className={styles.instructions}>
          Create <code>.env.local</code> from{" "}
          <code>.env.example</code>, add your Supabase values, then restart{" "}
          <code>npm run dev</code>.
        </p>
      </section>
    </Container>
  );
}
