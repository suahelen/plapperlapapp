// Package respond contains helpers for writing JSON API responses.
package respond

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
)

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func Error(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, errorBody{Error: errorDetail{Code: code, Message: message}})
}

// Internal logs err and responds with a generic 500 that reveals nothing about the cause.
func Internal(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("internal error", "method", r.Method, "path", r.URL.Path, "err", err)
	Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")
}

// Decode parses a JSON request body into dst. Unknown fields are rejected.
// Returns false (after writing a 400) on failure.
func Decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			Error(w, http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "Request body is too large.")
			return false
		}
		Error(w, http.StatusBadRequest, "INVALID_JSON", "Request body is not valid JSON.")
		return false
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		Error(w, http.StatusBadRequest, "INVALID_JSON", "Request body must contain a single JSON object.")
		return false
	}
	return true
}

// ValidationError writes a 400 with code VALIDATION_ERROR.
func ValidationError(w http.ResponseWriter, message string) {
	Error(w, http.StatusBadRequest, "VALIDATION_ERROR", message)
}
