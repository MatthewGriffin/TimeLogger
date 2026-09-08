/**
 * Setup Wizard Composable
 * Handles wizard state and logic
 */

import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore } from '../stores/config';
import type { SetupTestResult } from '../models/wizard';

type TestResult = SetupTestResult

const currentStep = ref(1);
const totalSteps = 6;
const saving = ref(false);
const errorMessage = ref('');
const wizardComplete = ref(false);
const isCheckingSetupStatus = ref(true);
const config = ref({
  jiraBaseUrl: '',
  jiraEmail: '',
  jiraApiToken: '',
  tempoApiToken: '',
  graphTenantId: '',
  graphClientId: '',
  graphClientSecret: '',
  ollamaHost: 'http://localhost:11434',
  ollamaModel: '',
  skipMicrosoft: false,
  skipOllama: false,
});
const testingJira = ref(false);
const jiraTestResult = ref<TestResult | null>(null);
const testingGraph = ref(false);
const graphTestResult = ref<TestResult | null>(null);
const testingOllama = ref(false);
const ollamaTestResult = ref<TestResult | null>(null);
const availableOllamaModels = ref<string[]>([]);
const hydrationTick = ref(0);
const microsoftSaved = ref(false);

export function useSetupWizard() {
  const configStore = useConfigStore();

  // Computed
  const progressPercent = computed(() => {
    return ((currentStep.value - 1) / (totalSteps - 1)) * 100;
  });

  const canProceedToNext = computed(() => {
    switch (currentStep.value) {
      case 1:
        return true;
      case 2:
        return true;
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  });

  // Methods
  function goToNextStep() {
    if (currentStep.value < totalSteps && canProceedToNext.value) {
      currentStep.value++;
    }
  }

  function goToPrevStep() {
    if (currentStep.value > 1) {
      currentStep.value--;
    }
  }

  function goToStep(step: number) {
    if (step >= 1 && step <= totalSteps) {
      currentStep.value = step;
    }
  }

  // A redacted secret from the backend is a display mask, not a usable value.
  // Hydrating a field with it would send the mask to Jira on the next test and
  // save it back as the credential, so masked values are dropped.
  const unmask = (value: unknown): string => {
    const str = typeof value === 'string' ? value : '';
    return /^\*+/.test(str) ? '' : str;
  };

  async function testJiraConnection() {
    testingJira.value = true;
    try {
      const json = await testBackendCommand<{ success: boolean; message: string; user?: any }>('test_jira_connection', {
        baseUrl: config.value.jiraBaseUrl,
        email: config.value.jiraEmail,
        apiToken: config.value.jiraApiToken,
        tempoToken: config.value.tempoApiToken,
      });
      jiraTestResult.value = {
        success: json.success,
        message: json.message,
        user: json.user,
      };

      if (!json.success) {
        errorMessage.value = json.message;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      jiraTestResult.value = {
        success: false,
        message: `Connection failed: ${errorMsg}`,
      };
      errorMessage.value = errorMsg;
    } finally {
      testingJira.value = false;
    }
  }

  async function testGraphConnection() {
    if (!config.value.graphClientId) {
      errorMessage.value = 'Please enter the Client ID';
      return;
    }

    testingGraph.value = true;
    try {
      const json = await testBackendCommand<{ success: boolean; message: string; user?: any; loginUrl?: string; requiresUserAuth?: boolean; redirectUri?: string; publicClient?: boolean }>('test_graph_connection', {
        tenantId: config.value.graphTenantId,
        clientId: config.value.graphClientId,
        clientSecret: config.value.graphClientSecret,
      });

      // The backend discards the secret for public client registrations, so
      // drop it here too rather than leaving a stale value in the form.
      if (json.publicClient) {
        config.value.graphClientSecret = '';
      }
      graphTestResult.value = {
        success: json.success,
        message: json.message,
        user: json.user,
        loginUrl: json.loginUrl,
        requiresUserAuth: json.requiresUserAuth,
        redirectUri: json.redirectUri,
      };

      if (!json.success) {
        errorMessage.value = json.message;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      graphTestResult.value = {
        success: false,
        message: `Connection failed: ${errorMsg}`,
      };
      errorMessage.value = errorMsg;
    } finally {
      testingGraph.value = false;
    }
  }

  async function testOllamaConnection() {
    if (!config.value.ollamaHost) {
      errorMessage.value = 'Please enter Ollama host';
      return;
    }

    testingOllama.value = true;
    try {
      const json = await testBackendCommand<{ success: boolean; message: string; models?: string[]; warning?: boolean }>('test_ollama_connection', {
        host: config.value.ollamaHost,
      });
      ollamaTestResult.value = {
        success: json.success,
        message: json.message,
        models: json.models || [],
        warning: json.warning || false,
      };
      availableOllamaModels.value = json.models || [];

      if (!json.success) {
        errorMessage.value = json.message;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      ollamaTestResult.value = {
        success: false,
        message: `Connection failed: ${errorMsg}`,
      };
      errorMessage.value = errorMsg;
    } finally {
      testingOllama.value = false;
    }
  }

  async function completeSetup() {
    // Validate required fields
    if (!config.value.jiraApiToken || !config.value.tempoApiToken) {
      errorMessage.value = 'Jira configuration is required';
      return;
    }

    saving.value = true;
    try {
      const result = await callBackendWithRetry('complete_setup', { config: config.value });
      // Keep the shared Pinia state in sync with the optional wizard flow.
      await configStore.saveConfig({
        jira: {
          baseUrl: config.value.jiraBaseUrl,
          email: config.value.jiraEmail,
          apiToken: config.value.jiraApiToken,
          tempoToken: config.value.tempoApiToken
        },
        microsoft: config.value.graphClientId ? {
          tenantId: config.value.graphTenantId,
          clientId: config.value.graphClientId,
          clientSecret: config.value.graphClientSecret,
          connected: microsoftSaved.value
        } : undefined,
        ollama: {
          host: config.value.ollamaHost,
          model: config.value.ollamaModel || 'llama3.2:1b',
          enabled: !config.value.skipOllama
        }
      });

      // Reload persisted state so the next launch sees the saved config.
      const status = await getSetupStatus() as any;
      if (status.completed && status.config) {
        wizardComplete.value = true;
        currentStep.value = totalSteps;
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorMessage.value = errorMsg;
      throw error;
    } finally {
      saving.value = false;
    }
  }

  function finishSetup() {
    // Emit event or navigate
    window.dispatchEvent(new CustomEvent('setup-complete', {
      detail: { config: config.value },
    }));
  }

  function dismissError() {
    errorMessage.value = '';
  }

  async function testBackendCommand<T>(command: string, payload: Record<string, unknown>) {
    return invoke<T>(command, payload);
  }

  async function getSetupStatus() {
    return callBackendWithRetry<{ completed: boolean; config?: unknown }>('get_setup_status', {});
  }

  async function callBackendWithRetry<T>(command: string, payload: Record<string, unknown>) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await testBackendCommand<T>(command, payload);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('ECONNREFUSED')) throw error;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Backend is not ready'));
  }

  // Load existing config if available
  async function loadExistingConfig() {
    try {
      if (!configStore.hasLoaded) await configStore.loadConfigFromBackend();
      if (configStore.config.jira || configStore.config.ollama) {
        const saved = configStore.config;
        config.value.jiraBaseUrl = saved.jira?.baseUrl || '';
        config.value.jiraEmail = saved.jira?.email || '';
        config.value.jiraApiToken = saved.jira?.apiToken || '';
        config.value.tempoApiToken = saved.jira?.tempoToken || '';
        config.value.graphTenantId = saved.microsoft?.tenantId || '';
        config.value.graphClientId = saved.microsoft?.clientId || '';
        config.value.graphClientSecret = saved.microsoft?.clientSecret || '';
        config.value.ollamaHost = saved.ollama?.host || 'http://localhost:11434';
        config.value.ollamaModel = saved.ollama?.model || '';
        config.value.skipOllama = saved.ollama?.enabled === false;
        wizardComplete.value = true;
        currentStep.value = 2;
        hydrationTick.value += 1;
        return;
      }
      const status = await getSetupStatus() as any;
      if (status.completed && status.config) {
        const saved = status.config.jira ? status.config : {
          jira: {
            baseUrl: status.config.jiraBaseUrl || '',
            email: status.config.jiraEmail || '',
            apiToken: status.config.jiraApiToken || '',
            tempoToken: status.config.tempoApiToken || '',
          },
          microsoft: status.config.microsoft || null,
          ollama: status.config.ollama || null,
        };

        config.value.jiraBaseUrl = saved.jira.baseUrl || '';
        config.value.jiraEmail = saved.jira.email || '';
        config.value.jiraApiToken = unmask(saved.jira.apiToken);
        config.value.tempoApiToken = unmask(saved.jira.tempoToken);
        config.value.graphTenantId = saved.microsoft?.tenantId || '';
        config.value.graphClientId = saved.microsoft?.clientId || '';
        config.value.graphClientSecret = unmask(saved.microsoft?.clientSecret);
        config.value.skipMicrosoft = saved.microsoft?.enabled === false;
        microsoftSaved.value = !!saved.microsoft?.clientId;
        config.value.ollamaHost = saved.ollama?.host || 'http://localhost:11434';
        config.value.ollamaModel = saved.ollama?.model || '';
        config.value.skipOllama = saved.ollama?.enabled === false;

        graphTestResult.value = saved.microsoft?.clientId
          ? { success: true, message: 'Microsoft integration saved.' }
          : graphTestResult.value;
        wizardComplete.value = true;
        currentStep.value = 2;
        hydrationTick.value += 1;
        return;
      }

      wizardComplete.value = false;
      currentStep.value = 1;
    } catch {
      wizardComplete.value = false;
      currentStep.value = 1;
    } finally {
      isCheckingSetupStatus.value = false;
    }
  }

  return {
    // State
    currentStep,
    totalSteps,
    config,
    saving,
    errorMessage,
    wizardComplete,
    isCheckingSetupStatus,
    testingJira,
    jiraTestResult,
    testingGraph,
    graphTestResult,
    testingOllama,
    ollamaTestResult,
    availableOllamaModels,
    hydrationTick,
    microsoftSaved,

    // Computed
    progressPercent,
    canProceedToNext,

    // Methods
    goToNextStep,
    goToPrevStep,
    goToStep,
    testJiraConnection,
    testGraphConnection,
    testOllamaConnection,
    completeSetup,
    finishSetup,
    dismissError,
    loadExistingConfig,
  };
}
