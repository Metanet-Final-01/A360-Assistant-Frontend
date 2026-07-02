<script setup>
import { computed, ref } from "vue";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const message = ref("Hello from Vue");
const serverMessage = ref("Not connected yet");
const responseBody = ref({});
const status = ref("idle");
const errorMessage = ref("");

const isOnline = computed(() => status.value === "connected");

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}

async function checkConnection() {
  status.value = "loading";
  errorMessage.value = "";

  try {
    const data = await request("/api/message");
    serverMessage.value = data.message;
    responseBody.value = data;
    status.value = "connected";
  } catch (error) {
    serverMessage.value = "Backend connection failed.";
    responseBody.value = {};
    errorMessage.value = error.message;
    status.value = "error";
  }
}

async function sendEcho() {
  status.value = "loading";
  errorMessage.value = "";

  try {
    const data = await request("/api/echo", {
      method: "POST",
      body: JSON.stringify({ message: message.value }),
    });
    responseBody.value = data;
    status.value = "connected";
  } catch (error) {
    errorMessage.value = error.message;
    status.value = "error";
  }
}

checkConnection();
</script>

<template>
  <main class="page">
    <section class="panel" aria-labelledby="page-title">
      <div class="masthead">
        <img src="/src/assets/a360-mark.svg" alt="" class="logo" />
        <div>
          <p class="eyebrow">Vue frontend test</p>
          <h1 id="page-title">A360 Assistant</h1>
        </div>
        <span class="badge" :class="{ online: isOnline }">
          {{ isOnline ? "Connected" : status }}
        </span>
      </div>

      <div class="summary">
        <span>Backend</span>
        <strong>{{ apiBaseUrl }}</strong>
      </div>

      <p class="server-message">{{ serverMessage }}</p>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

      <form class="composer" @submit.prevent="sendEcho">
        <label for="message">Message</label>
        <div class="input-row">
          <input id="message" v-model="message" autocomplete="off" />
          <button type="submit">Send</button>
        </div>
      </form>

      <button class="secondary" type="button" @click="checkConnection">
        Check connection
      </button>

      <pre>{{ JSON.stringify(responseBody, null, 2) }}</pre>
    </section>
  </main>
</template>
