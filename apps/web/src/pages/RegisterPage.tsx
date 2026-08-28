import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { registerSchema } from "@event-planner/shared";

import { ApiError } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";

export default function RegisterPage() {
  const { register } = useAuth();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setFieldErrors({});
    setFormError(null);

    const result = registerSchema.safeParse(form);

    if (!result.success) {
      const errors: Record<string, string> = {};

      for (const issue of result.error.issues) {
        const field = issue.path[0];

        if (typeof field === "string") {
          errors[field] ??= issue.message;
        } else {
          setFormError(issue.message);
        }
      }

      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);

    try {
      await register(result.data.name, result.data.email, result.data.password);
    } catch (error) {
      if (error instanceof ApiError) {
        const errors: Record<string, string> = {};

        if (error.fields) {
          for (const [field, messages] of Object.entries(error.fields)) {
            if (field === "_form" || field === "") {
              setFormError(
                (Array.isArray(messages) ? messages[0] : String(messages)) ??
                  error.message,
              );
              continue;
            }

            errors[field] =
              (Array.isArray(messages) ? messages[0] : String(messages)) ??
              error.message;
          }
        }

        setFieldErrors(errors);

        if (!error.fields) {
          setFormError(error.message);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Create account</h1>

      {formError && <p role="alert">{formError}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="name">Name</label>

          <input
            id="name"
            name="name"
            type="text"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
          />

          {fieldErrors.name && <p id="name-error">{fieldErrors.name}</p>}
        </div>

        <div>
          <label htmlFor="email">Email</label>

          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                email: event.target.value,
              }))
            }
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />

          {fieldErrors.email && <p id="email-error">{fieldErrors.email}</p>}
        </div>

        <div>
          <label htmlFor="password">Password</label>

          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                password: event.target.value,
              }))
            }
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={
              fieldErrors.password ? "password-error" : undefined
            }
          />

          {fieldErrors.password && (
            <p id="password-error">{fieldErrors.password}</p>
          )}
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Register"}
        </button>
      </form>

      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
