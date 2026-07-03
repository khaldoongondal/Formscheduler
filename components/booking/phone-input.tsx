"use client";

import { useMemo, useState } from "react";

interface PhoneInputProps {
  className?: string;
  defaultValue?: string;
}

interface AllowedCountry {
  iso: string;
  flag: string;
  name: string;
  dialCode: string;
  minDigits: number;
  maxDigits: number;
  groups: number[];
}

const allowedCountries: AllowedCountry[] = [
  { iso: "US", flag: "🇺🇸", name: "United States", dialCode: "+1", minDigits: 10, maxDigits: 10, groups: [3, 3, 4] },
  { iso: "CA", flag: "🇨🇦", name: "Canada", dialCode: "+1", minDigits: 10, maxDigits: 10, groups: [3, 3, 4] },
  { iso: "GB", flag: "🇬🇧", name: "United Kingdom", dialCode: "+44", minDigits: 10, maxDigits: 10, groups: [4, 3, 3] },
  { iso: "IE", flag: "🇮🇪", name: "Ireland", dialCode: "+353", minDigits: 9, maxDigits: 9, groups: [2, 3, 4] },
  { iso: "AU", flag: "🇦🇺", name: "Australia", dialCode: "+61", minDigits: 9, maxDigits: 9, groups: [1, 4, 4] },
  { iso: "NZ", flag: "🇳🇿", name: "New Zealand", dialCode: "+64", minDigits: 8, maxDigits: 9, groups: [2, 3, 4] },
  { iso: "FR", flag: "🇫🇷", name: "France", dialCode: "+33", minDigits: 9, maxDigits: 9, groups: [1, 2, 2, 2, 2] },
  { iso: "DE", flag: "🇩🇪", name: "Germany", dialCode: "+49", minDigits: 10, maxDigits: 11, groups: [3, 4, 4] },
  { iso: "NL", flag: "🇳🇱", name: "Netherlands", dialCode: "+31", minDigits: 9, maxDigits: 9, groups: [2, 3, 4] },
  { iso: "BE", flag: "🇧🇪", name: "Belgium", dialCode: "+32", minDigits: 9, maxDigits: 9, groups: [2, 3, 4] },
  { iso: "CH", flag: "🇨🇭", name: "Switzerland", dialCode: "+41", minDigits: 9, maxDigits: 9, groups: [2, 3, 4] },
  { iso: "AT", flag: "🇦🇹", name: "Austria", dialCode: "+43", minDigits: 10, maxDigits: 10, groups: [3, 3, 4] },
  { iso: "ES", flag: "🇪🇸", name: "Spain", dialCode: "+34", minDigits: 9, maxDigits: 9, groups: [3, 3, 3] },
  { iso: "IT", flag: "🇮🇹", name: "Italy", dialCode: "+39", minDigits: 9, maxDigits: 10, groups: [3, 3, 4] },
  { iso: "PT", flag: "🇵🇹", name: "Portugal", dialCode: "+351", minDigits: 9, maxDigits: 9, groups: [3, 3, 3] },
  { iso: "SE", flag: "🇸🇪", name: "Sweden", dialCode: "+46", minDigits: 9, maxDigits: 9, groups: [2, 3, 4] },
  { iso: "NO", flag: "🇳🇴", name: "Norway", dialCode: "+47", minDigits: 8, maxDigits: 8, groups: [3, 2, 3] },
  { iso: "DK", flag: "🇩🇰", name: "Denmark", dialCode: "+45", minDigits: 8, maxDigits: 8, groups: [2, 2, 2, 2] },
  { iso: "FI", flag: "🇫🇮", name: "Finland", dialCode: "+358", minDigits: 9, maxDigits: 10, groups: [2, 3, 5] },
  { iso: "MX", flag: "🇲🇽", name: "Mexico", dialCode: "+52", minDigits: 10, maxDigits: 10, groups: [2, 4, 4] },
  { iso: "IN", flag: "🇮🇳", name: "India", dialCode: "+91", minDigits: 10, maxDigits: 10, groups: [5, 5] },
  { iso: "PK", flag: "🇵🇰", name: "Pakistan", dialCode: "+92", minDigits: 10, maxDigits: 10, groups: [3, 7] }
];

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatNationalNumber(digits: string, groups: number[]) {
  const parts: string[] = [];
  let cursor = 0;

  for (const groupLength of groups) {
    const part = digits.slice(cursor, cursor + groupLength);
    if (part) parts.push(part);
    cursor += groupLength;
  }

  const remaining = digits.slice(cursor);
  if (remaining) parts.push(remaining);

  return parts.join(" ");
}

function getInitialPhoneState(defaultValue: string | undefined) {
  const normalizedValue = defaultValue?.trim() ?? "";
  const country = [...allowedCountries]
    .sort((first, second) => second.dialCode.length - first.dialCode.length)
    .find((item) => normalizedValue.startsWith(item.dialCode)) ?? allowedCountries[0];
  const nationalDigits = normalizedValue.startsWith(country.dialCode)
    ? onlyDigits(normalizedValue.slice(country.dialCode.length)).slice(0, country.maxDigits)
    : "";

  return { countryIso: country.iso, nationalDigits };
}

export function PhoneInput({ className = "", defaultValue }: PhoneInputProps) {
  const initialPhoneState = useMemo(() => getInitialPhoneState(defaultValue), [defaultValue]);
  const [countryIso, setCountryIso] = useState(initialPhoneState.countryIso);
  const [nationalDigits, setNationalDigits] = useState(initialPhoneState.nationalDigits);
  const country = allowedCountries.find((item) => item.iso === countryIso) ?? allowedCountries[0];
  const formattedNumber = useMemo(
    () => formatNationalNumber(nationalDigits, country.groups),
    [country.groups, nationalDigits]
  );
  const isValidPhone = nationalDigits.length >= country.minDigits && nationalDigits.length <= country.maxDigits;
  const submittedPhone = isValidPhone ? `${country.dialCode}${nationalDigits}` : "";

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-slate-800" htmlFor="phone-national">
        Phone Number
      </label>
      <div
        className={`flex min-h-12 w-full overflow-hidden rounded-[var(--radius)] border border-slate-300 bg-white text-base text-slate-950 transition focus-within:border-slate-950 ${className}`}
      >
        <div className="relative flex w-[72px] shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50">
          <span className="mr-3 text-lg leading-none" aria-hidden="true">
            {country.flag}
          </span>
          <select
            aria-label="Country"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={countryIso}
            onChange={(event) => {
              const nextCountry = allowedCountries.find((item) => item.iso === event.target.value) ?? allowedCountries[0];
              setCountryIso(nextCountry.iso);
              setNationalDigits((current) => current.slice(0, nextCountry.maxDigits));
            }}
          >
            {allowedCountries.map((item) => (
              <option key={item.iso} value={item.iso}>
                {item.flag} {item.name} {item.dialCode}
              </option>
            ))}
          </select>
          <span
            className="pointer-events-none absolute right-3 h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-slate-500"
            aria-hidden="true"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
          <span className="shrink-0 font-semibold text-slate-950">{country.dialCode}</span>
          <input
            id="phone-national"
            type="tel"
            required
            autoComplete="tel-national"
            inputMode="tel"
            placeholder="Phone Number"
            className="min-w-0 flex-1 bg-transparent text-base text-slate-950 outline-none placeholder:text-slate-400"
            value={formattedNumber}
            onChange={(event) => {
              setNationalDigits(onlyDigits(event.target.value).slice(0, country.maxDigits));
            }}
          />
        </div>
        <input type="hidden" name="phone" value={submittedPhone} />
      </div>
    </div>
  );
}
