"use client";

import { useActionState, useState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { tierOfDepartment } from "@/lib/department-rules";
import { TIER_HOURS, TIERS, type Tier } from "@/lib/tiers";
import type { MemberFormState, MemberValues } from "./actions";
import { CopyLink } from "./copy-link";

type Props = {
  action: (prev: MemberFormState, formData: FormData) => Promise<MemberFormState>;
  initial: MemberValues;
  departments: { id: number; name: string }[];
  submitLabel: string;
  isSelf?: boolean;
};

export function MemberForm({ action, initial, departments, submitLabel, isSelf }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  if (state.created) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-success-line bg-success-bg p-4">
        <p className="font-semibold text-success">{state.created.name} was added.</p>
        <p className="text-sm text-success">Send them this link so they can set a password.</p>
        <CopyLink url={state.created.url} expiresAt={state.created.expiresAt} />
        <a href={`/admin/members/${state.created.id}`} className="self-start text-sm font-medium underline underline-offset-2">
          Open member
        </a>
      </div>
    );
  }

  // Remount with the submitted values after a failed submit (React resets uncontrolled forms).
  const values = state.values ?? initial;
  return (
    <FormFields
      key={JSON.stringify(values)}
      values={values}
      departments={departments}
      errors={state.errors ?? {}}
      formAction={formAction}
      pending={pending}
      submitLabel={submitLabel}
      isSelf={isSelf}
    />
  );
}

function FormFields({
  values,
  departments,
  errors,
  formAction,
  pending,
  submitLabel,
  isSelf,
}: {
  values: MemberValues;
  departments: { id: number; name: string }[];
  errors: NonNullable<MemberFormState["errors"]>;
  formAction: (formData: FormData) => void;
  pending: boolean;
  submitLabel: string;
  isSelf?: boolean;
}) {
  const [tier, setTier] = useState(values.tier || "");
  const [hours, setHours] = useState(values.weeklyHours);
  const [departmentIds, setDepartmentIds] = useState<string[]>(values.departmentIds);

  function changeTier(next: string) {
    // Follow the tier's default hours unless the admin typed a custom number.
    const prevDefault = tier ? String(TIER_HOURS[tier as Tier]) : "";
    if (hours === "" || hours === prevDefault) setHours(next ? String(TIER_HOURS[next as Tier]) : "");
    // A department named like a tier (Core) follows the tier: ticked for its members, unticked for others.
    setDepartmentIds((ids) => [
      ...ids.filter((id) => !tierOfDepartment(departments.find((d) => String(d.id) === id)?.name ?? "")),
      ...departments.filter((d) => tierOfDepartment(d.name) === next).map((d) => String(d.id)),
    ]);
    setTier(next);
  }

  function toggleDepartment(id: string, on: boolean) {
    setDepartmentIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field label="Name" error={errors.name}>
        <input name="name" defaultValue={values.name} autoComplete="off" className={inputClass} />
      </Field>
      <Field label="Email" error={errors.email}>
        <input name="email" type="email" defaultValue={values.email} autoComplete="off" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tier" error={errors.tier}>
          <select name="tier" value={tier} onChange={(e) => changeTier(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weekly hours" error={errors.weeklyHours}>
          <input
            name="weeklyHours"
            inputMode="numeric"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field error={errors.departmentIds}>
        <fieldset className="flex flex-col gap-2">
          <legend className={`${labelClass} mb-1.5`}>Departments</legend>
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => {
              const onlyFor = tierOfDepartment(d.name);
              const blocked = onlyFor !== null && onlyFor !== tier;
              return (
                <label
                  key={d.id}
                  className={`flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm ${blocked ? "opacity-60" : ""}`}
                  title={onlyFor ? `Only for members of the ${onlyFor} tier` : undefined}
                >
                  <input
                    type="checkbox"
                    name="departmentIds"
                    value={d.id}
                    checked={departmentIds.includes(String(d.id))}
                    disabled={blocked}
                    onChange={(e) => toggleDepartment(String(d.id), e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  {d.name}
                  {onlyFor && <span className="text-xs text-subtle">({onlyFor} tier only)</span>}
                </label>
              );
            })}
          </div>
          <span className="text-xs text-subtle">Any number, or none. A task given to a department shows for everyone in it.</span>
        </fieldset>
      </Field>
      <Field error={errors.isAdmin}>
        <label className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <input name="isAdmin" type="checkbox" defaultChecked={values.isAdmin} className="size-5 accent-primary" />
          <span>
            <span className="font-medium">Admin</span>
            <span className="block text-xs text-subtle">
              Can manage members and see admin pages.{isSelf && " You cannot remove your own admin role."}
            </span>
          </span>
        </label>
      </Field>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function Field({ label, error, children }: { label?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>{label}</span>
          {children}
        </label>
      ) : (
        children
      )}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}
