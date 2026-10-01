package answer

// leadWords may precede an answer ("vous allez" for "allez"); they are only ever dropped
// from the given answer, never required. Must equal shared/lead-words.json (see tests),
// which the frontend reads directly.
var leadWords = setOf(
	"der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
	"ich", "du", "er", "sie", "es", "wir", "ihr", "man",

	"le", "la", "les", "un", "une", "de", // "du" is listed with German
	"je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",

	"the", "a", "an", "to", "i", "you", "he", "she", "it", "we", "they",

	"lo", "gli", "uno", "una", "io", "lui", "lei", "noi", "voi", "loro",

	"el", "los", "las", "unos", "unas", "yo", "tú", "él", "ella", "nosotros", "nosotras",
	"vosotros", "vosotras", "ellos", "ellas", "usted", "ustedes",
)

// elided forms are stripped from the start of a word (j'aime → aime).
var elided = []string{"j'", "l'", "d'", "m'", "t'", "s'", "n'", "qu'", "un'", "c'"}

func setOf(words ...string) map[string]bool {
	m := make(map[string]bool, len(words))
	for _, w := range words {
		m[w] = true
	}
	return m
}
