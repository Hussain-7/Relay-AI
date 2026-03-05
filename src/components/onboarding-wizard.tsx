"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Provider = "openai" | "anthropic";

interface ModelsPayload {
  connected?: {
    openai?: boolean;
    anthropic?: boolean;
  };
  models?: Array<{
    id: string;
    provider: "OPENAI" | "ANTHROPIC";
    modelId: string;
    displayName: string;
  }>;
}

interface OnboardingState {
  currentStep: string;
  isCompleted: boolean;
  stepDataJson?: Record<string, unknown> | null;
}

const STEPS = [
  "providers",
  "models",
  "github",
  "integrations",
  "review",
] as const;

export function OnboardingWizard(props: {
  onboarding: OnboardingState;
  user: {
    email: string;
    fullName: string | null;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initialStepIndex = Math.max(
    0,
    STEPS.indexOf(props.onboarding.currentStep as (typeof STEPS)[number]),
  );
  const [stepIndex, setStepIndex] = useState(initialStepIndex);
  const step = STEPS[stepIndex];

  const [models, setModels] = useState<ModelsPayload | null>(null);
  const [provider, setProvider] = useState<Provider>("openai");
  const [apiKey, setApiKey] = useState("");

  const [preferredModel, setPreferredModel] = useState<string>(
    (props.onboarding.stepDataJson?.preferredModel as string) ?? "",
  );
  const [modelRouting, setModelRouting] = useState<string>(
    (props.onboarding.stepDataJson?.modelRouting as string) ?? "quality_first",
  );

  const connectedCount = useMemo(() => {
    let count = 0;
    if (models?.connected?.openai) count += 1;
    if (models?.connected?.anthropic) count += 1;
    return count;
  }, [models]);

  const requestJson = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      return payload as T;
    },
    [],
  );

  const loadModels = useCallback(async () => {
    const payload = await requestJson<ModelsPayload>("/api/models");
    setModels(payload);
    if (!preferredModel && payload.models?.length) {
      setPreferredModel(payload.models[0].modelId);
    }
  }, [preferredModel, requestJson]);

  useEffect(() => {
    void Promise.resolve()
      .then(loadModels)
      .catch((loadError) => {
        const message =
          loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
      });
  }, [loadModels]);

  useEffect(() => {
    const github = searchParams.get("github");
    const githubError = searchParams.get("github_error");
    if (github === "connected") {
      setFeedback("GitHub App connected. You can continue onboarding.");
    } else if (githubError) {
      setError(`GitHub connection failed: ${githubError}`);
    }
  }, [searchParams]);

  async function saveStep(nextStep: (typeof STEPS)[number]) {
    setSaving(true);
    setError(null);
    try {
      await requestJson("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          currentStep: nextStep,
          stepData: {
            preferredModel: preferredModel || null,
            modelRouting,
          },
        }),
      });
      setStepIndex(STEPS.indexOf(nextStep));
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (!apiKey.trim()) {
      setError("API key is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await requestJson("/api/providers/keys", {
        method: "POST",
        body: JSON.stringify({
          provider,
          apiKey,
        }),
      });
      setApiKey("");
      await loadModels();
      setFeedback(`${provider.toUpperCase()} key saved.`);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function startGithubInstall() {
    setSaving(true);
    setError(null);
    try {
      const payload = await requestJson<{ installUrl: string }>(
        "/api/github/install-url",
      );
      window.location.href = payload.installUrl;
    } catch (installError) {
      const message =
        installError instanceof Error ? installError.message : String(installError);
      setError(message);
      setSaving(false);
    }
  }

  async function completeOnboarding() {
    setSaving(true);
    setError(null);
    try {
      await requestJson("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          currentStep: "review",
          stepData: {
            preferredModel: preferredModel || null,
            modelRouting,
          },
          complete: true,
        }),
      });
      router.push("/chat");
      router.refresh();
    } catch (completeError) {
      const message =
        completeError instanceof Error
          ? completeError.message
          : String(completeError);
      setError(message);
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-white/40 bg-white/80 p-6 shadow-[0_20px_80px_rgba(12,24,40,0.12)] backdrop-blur md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Onboarding
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 md:text-3xl">
          Configure your agent workspace
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Signed in as {props.user.fullName ?? props.user.email}. You can edit
          everything later from Settings.
        </p>

        <ol className="mt-6 grid gap-2 md:grid-cols-5">
          {STEPS.map((item, index) => (
            <li key={item}>
              <div
                className={`rounded-lg border px-3 py-2 text-center text-xs font-medium uppercase tracking-wide ${
                  index === stepIndex
                    ? "border-slate-900 bg-slate-900 text-white"
                    : index < stepIndex
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500"
                }`}
              >
                {item}
              </div>
            </li>
          ))}
        </ol>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          {step === "providers" ? (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Step 1: BYOK Providers (Required)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Add at least one provider key to continue.
              </p>
              <form onSubmit={saveProvider} className="mt-4 grid gap-2 md:grid-cols-4">
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as Provider)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="API key"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Save key
                </button>
              </form>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                Connected providers: {connectedCount === 0 ? "none" : connectedCount}
              </div>
            </div>
          ) : null}

          {step === "models" ? (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Step 2: Model Defaults
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Set the preferred model and routing behavior.
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <select
                  value={preferredModel}
                  onChange={(event) => setPreferredModel(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {models?.models?.map((model) => (
                    <option key={model.id} value={model.modelId}>
                      {model.displayName}
                    </option>
                  ))}
                  {!models?.models?.length ? (
                    <option value="">No connected models</option>
                  ) : null}
                </select>
                <select
                  value={modelRouting}
                  onChange={(event) => setModelRouting(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="quality_first">Quality first</option>
                  <option value="provider_pinned">Provider pinned</option>
                </select>
              </div>
            </div>
          ) : null}

          {step === "github" ? (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Step 3: Connect GitHub (Optional)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Required only for coding workflows that push branches and open PRs.
              </p>
              <button
                type="button"
                onClick={() => {
                  void startGithubInstall();
                }}
                disabled={saving}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Install GitHub App
              </button>
            </div>
          ) : null}

          {step === "integrations" ? (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Step 4: Integrations (Optional)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                You can add connectors, MCP servers, and custom tools later in
                the settings workspace.
              </p>
              <p className="mt-4 text-sm text-slate-700">
                Recommended next: configure at least one remote MCP server and
                one custom connector.
              </p>
            </div>
          ) : null}

          {step === "review" ? (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Step 5: Review and Finish
              </h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                <li>
                  Providers connected:{" "}
                  {models?.connected?.openai || models?.connected?.anthropic
                    ? "Yes"
                    : "No"}
                </li>
                <li>Preferred model: {preferredModel || "Not set"}</li>
                <li>Routing policy: {modelRouting}</li>
              </ul>
              <button
                type="button"
                onClick={() => {
                  void completeOnboarding();
                }}
                disabled={saving}
                className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Complete onboarding
              </button>
            </div>
          ) : null}
        </section>

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            disabled={saving || stepIndex === 0}
            onClick={() => {
              void saveStep(STEPS[Math.max(0, stepIndex - 1)]);
            }}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            disabled={
              saving ||
              stepIndex >= STEPS.length - 1 ||
              (step === "providers" && connectedCount === 0)
            }
            onClick={() => {
              void saveStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Continue
          </button>
        </div>

        {feedback ? <p className="mt-3 text-sm text-emerald-600">{feedback}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}
