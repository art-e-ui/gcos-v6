const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const apiFetch = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  // If endpoint is relative like '/api/health', prepend base URL if set
  const url = endpoint.startsWith('/') && API_BASE_URL 
    ? `${API_BASE_URL}${endpoint}` 
    : endpoint;

  return fetch(url, options);
};
