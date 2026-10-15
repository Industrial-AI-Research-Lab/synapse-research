const TEAM_ACCESS_KEY = "pav.teamAccessToken";

export const getTeamAccessToken = () => {
  try {
    return sessionStorage.getItem(TEAM_ACCESS_KEY) ?? "";
  } catch {
    return "";
  }
};

export const setTeamAccessToken = (value: string) => {
  try {
    if (value.trim()) sessionStorage.setItem(TEAM_ACCESS_KEY, value.trim());
    else sessionStorage.removeItem(TEAM_ACCESS_KEY);
  } catch {
    return;
  }
};
