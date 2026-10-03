/** add-privacy-and-compliance 5.1: RFC 9116 required/recommended fields, and Expires in the future but <= 365 days. */
export function checkSecurityTxt(text, now = new Date()) {
  const field = (name) => text.split('\n').map((l) => l.trim()).filter((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`)).map((l) => l.slice(name.length + 1).trim());
  const errors = [];
  for (const f of ['Contact', 'Expires', 'Policy', 'Canonical', 'Preferred-Languages']) if (field(f).length === 0) errors.push(`security.txt: missing ${f}`);
  const exp = field('Expires')[0];
  if (exp) {
    const t = Date.parse(exp);
    if (Number.isNaN(t)) errors.push(`security.txt: Expires is not a date: ${exp}`);
    else if (t <= now.getTime()) errors.push(`security.txt: Expires ${exp} is in the past`);
    else if (t - now.getTime() > 365 * 86_400_000) errors.push(`security.txt: Expires ${exp} is more than 365 days ahead`);
  }
  return errors;
}
