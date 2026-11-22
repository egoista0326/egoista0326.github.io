// Dates written "YYYY.M" in the photography data (news, project start dates; src/data/photography.ts). The Chinese
// text shows them as written; in English "2025.6" would read as a decimal, so it reads "Jun 2025" there.

const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "YYYY.M" as "Mon YYYY" (e.g. "2026.1" -> "Jan 2026"); any other text is returned unchanged. */
export const formatYearMonthEn = (date: string): string => {
  const match = /^(\d{4})\.(\d{1,2})$/.exec(date);
  const month = match ? monthsEn[Number(match[2]) - 1] : undefined;
  return match && month ? `${month} ${match[1]}` : date;
};
