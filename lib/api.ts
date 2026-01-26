import axios from "axios";

const API = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

API.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export const registerUser = (data: any) => API.post("/api/auth/register", data);

export const loginUser = (data: any) => API.post("/api/auth/login", data);

export const getLastSeen = (userId: string) =>
  API.get(`/api/users/${userId}/last-seen`);

export const getUsersStatus = (userIds: string[]) =>
  API.post("/api/users/status", { userIds });

export const getUserOnline = (userId: string) =>
  API.get(`/api/users/${userId}/online`);

export const getConversations = () => API.get("/api/conversations/");

export const getConversationList = () => API.get("/api/conversations/list");

export const getMessages = (conversationId: string) =>
  API.get(`/api/conversations/${conversationId}/messages`);

export default API;
