"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, MousePointer2 } from "lucide-react";
import styles from "./home.module.css";

const projectOptions = ["A new project", "An existing project", "Just exploring"];
const exampleTimes = ["Tuesday morning", "Wednesday afternoon", "Thursday morning"];

export function FormPreview() {
  const [step, setStep] = useState<"project" | "time" | "done">("project");
  const [project, setProject] = useState(projectOptions[0]);
  const [time, setTime] = useState(exampleTimes[0]);
  const heading = useRef<HTMLHeadingElement>(null);
  const exploring = project === "Just exploring";
  const question = step === "project" ? "What brings you in?" : step === "time" ? "When works for you?" : "Thanks for trying it.";
  const options = step === "project" ? projectOptions : exampleTimes;

  function moveTo(next: typeof step) {
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }

  return (
    <aside className={styles.previewStage} aria-label="Interactive example form">
      <div className={styles.previewTop}><span>Example form</span><MousePointer2 size={15} aria-hidden="true" /></div>
      <div className={styles.previewPaper}>
        <div className={styles.previewHeader}>
          <span className={styles.clientMark} aria-hidden="true">S.</span>
          <span>Studio consultation</span>
        </div>
        <div className={styles.progress} aria-hidden="true">
          <span /><span data-filled={step !== "project"} />
        </div>
        <h2 ref={heading} tabIndex={-1} className={styles.question}>{question}</h2>
        {step === "done" ? (
          <div className={styles.demoResult}>
            <p>{exploring
              ? "This answer ends the example form before the calendar."
              : `You chose ${time} for ${project.toLowerCase()}. This preview doesn’t book a call.`}</p>
            <button type="button" className={styles.demoSubmit} onClick={() => moveTo("project")}>
              Try again <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); moveTo(step === "project" && !exploring ? "time" : "done"); }}>
            <fieldset className={styles.optionGroup}>
              <legend className="sr-only">{question}</legend>
              {options.map((option) => (
                <label key={option} className={styles.option}>
                  <input type="radio" name={step} checked={(step === "project" ? project : time) === option}
                    onChange={() => step === "project" ? setProject(option) : setTime(option)} />
                  <span className={styles.radio} aria-hidden="true" />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
            <div className={styles.demoActions}>
              {step === "time" && <button type="button" className={styles.back} aria-label="Back to project question" onClick={() => moveTo("project")}><ArrowLeft size={16} aria-hidden="true" /></button>}
              <button type="submit" className={styles.demoSubmit}>
                {step === "project" ? "Continue" : "Finish preview"} <ArrowRight size={15} aria-hidden="true" />
              </button>
              <span className={styles.demoStep}>{step === "project" ? "Question" : "Example times"}</span>
            </div>
          </form>
        )}
        {step === "done" && <Check className={styles.demoCheck} size={22} aria-hidden="true" />}
      </div>
    </aside>
  );
}
