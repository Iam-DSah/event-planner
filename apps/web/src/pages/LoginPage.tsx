import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { loginSchema } from "@event-planner/shared";

import { ApiError } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";

export default function LoginPage() {
  const { login } = useAuth();

  const [form, setForm] = useState({
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

    const result = loginSchema.safeParse(form);

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
      await login(result.data.email, result.data.password);
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
    <main className="page-body flex min-h-[calc(100dvh-12rem)] max-w-md flex-col justify-center">
      <h1 className="font-display text-4xl leading-tight text-ink">Log in</h1>

      <p className="mt-2 text-ink-muted">
        Sign in to see your events and create new ones.
      </p>

      {formError && (
        <p role="alert" className="alert mt-6">
          {formError}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>

          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="input"
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

          {fieldErrors.email && (
            <p id="email-error" className="field-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="label">
            Password
          </label>

          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="input"
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
            <p id="password-error" className="field-error">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary w-full"
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        No account?{" "}
        <Link to="/register" className="font-medium text-accent">
          Sign up
        </Link>
      </p>
    </main>
  );
}
