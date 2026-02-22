export function resolveAdultFilter(
  searchParams: URLSearchParams,
  disableYellowFilter: boolean,
): boolean {
  let shouldFilterAdult = !disableYellowFilter;

  const adultParam = searchParams.get('adult');
  const filterParam = searchParams.get('filter');

  if (adultParam === '1' || adultParam === 'true') {
    shouldFilterAdult = false;
  } else if (adultParam === '0' || adultParam === 'false') {
    shouldFilterAdult = true;
  } else if (filterParam === 'off' || filterParam === 'disable') {
    shouldFilterAdult = false;
  } else if (filterParam === 'on' || filterParam === 'enable') {
    shouldFilterAdult = true;
  }

  return shouldFilterAdult;
}
