package activities

import (
	"crypto/rand"
	"math/big"
	"strings"
)

// Unambiguous characters only (no 0/O, 1/I/L) so IDs are easy to read aloud and type.
const (
	publicIDAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
	publicIDLength   = 8 // 31^8 ≈ 8.5e11 combinations (~40 bits)
)

func newPublicID() (string, error) {
	var b strings.Builder
	max := big.NewInt(int64(len(publicIDAlphabet)))
	for range publicIDLength {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(publicIDAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// normalizePublicID uppercases and validates a public ID from a URL.
func normalizePublicID(s string) (string, bool) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if len(s) != publicIDLength {
		return "", false
	}
	for _, c := range s {
		if !strings.ContainsRune(publicIDAlphabet, c) {
			return "", false
		}
	}
	return s, true
}
