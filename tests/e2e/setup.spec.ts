import { test, expect } from "@playwright/test";

test("redirects a signed-out user to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
});

test("shows the complete sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in with google/i })).toBeVisible();
});

test("can reveal and hide a password without submitting", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  const password = page.getByLabel("Password");
  await password.fill("example-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
});

test("applies a saved theme before the login screen renders", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("adflow-theme", "dark"));
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("keeps a saved light theme when the system prefers dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => window.localStorage.setItem("adflow-theme", "light"));
  await page.goto("/login");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
