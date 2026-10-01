// Package config loads application settings from environment variables.
package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL    string
	SessionSecret  []byte
	AppBaseURL     string
	HTTPPort       string
	CookieSecure   bool
	TrustProxy     bool
	MigrationsPath string
	// ASRURL points at the speech-to-text sidecar; empty disables spoken answers.
	ASRURL string
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		SessionSecret:  []byte(os.Getenv("SESSION_SECRET")),
		AppBaseURL:     getenv("APP_BASE_URL", "http://localhost:5173"),
		HTTPPort:       getenv("HTTP_PORT", "8080"),
		CookieSecure:   parseBool(os.Getenv("COOKIE_SECURE")),
		TrustProxy:     parseBool(os.Getenv("TRUST_PROXY")),
		MigrationsPath: getenv("MIGRATIONS_PATH", "../database/migrations"),
		ASRURL:         os.Getenv("ASR_URL"),
	}
	if cfg.DatabaseURL == "" {
		return cfg, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

// ValidateForServe checks settings only needed when running the HTTP server.
func (c Config) ValidateForServe() error {
	if len(c.SessionSecret) < 16 {
		return errors.New("SESSION_SECRET must be at least 16 characters")
	}
	return nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
