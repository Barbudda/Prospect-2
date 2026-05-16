import { parsePhoneNumberFromString, findPhoneNumbersInText } from "libphonenumber-js/max";

// Test the import path tsx uses
console.log("typeof parsePhoneNumberFromString:", typeof parsePhoneNumberFromString);

try {
  const p = parsePhoneNumberFromString("+33559741032", "FR");
  console.log("parse result:", p && { e164: p.number, valid: p.isValid(), country: p.country });
} catch (e) {
  console.log("THREW:", e instanceof Error ? e.message : String(e));
  console.log(e);
}

try {
  for (const m of findPhoneNumbersInText("Call +33 5 59 74 10 32 or +1 415 555 0132", "FR")) {
    console.log("found:", m.number.number, m.number.country, m.number.isValid());
  }
} catch (e) {
  console.log("findPhoneNumbersInText THREW:", e instanceof Error ? e.message : String(e));
}
