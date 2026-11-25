package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type userModelUsageResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    struct {
		Items    []model.UserModelUsageRow   `json:"items"`
		Total    int64                       `json:"total"`
		Page     int                         `json:"page"`
		PageSize int                         `json:"page_size"`
		Summary  model.UserModelUsageSummary `json:"summary"`
	} `json:"data"`
}

type userModelUsageOptionsResponse struct {
	Success bool     `json:"success"`
	Message string   `json:"message"`
	Data    []string `json:"data"`
}

// setupUserModelUsageTestDB installs an in-memory SQLite database. The matrix
// test runs the same contract on real MySQL and PostgreSQL through
// newAuditTestDatabase.
func setupUserModelUsageTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gin.SetMode(gin.TestMode)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		_ = sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.QuotaData{}))
	return db
}

// seedUserModelUsage records hourly rows. A zero CreatedAt becomes bucket 3600,
// which every test window covers.
func seedUserModelUsage(t *testing.T, db *gorm.DB, rows ...model.QuotaData) {
	t.Helper()
	for _, row := range rows {
		if row.Count == 0 {
			row.Count = 1
		}
		if row.CreatedAt == 0 {
			row.CreatedAt = 3600
		}
		require.NoError(t, db.Create(&row).Error, "seed %+v", row)
	}
}

func runUserModelUsageRequest(t *testing.T, handler gin.HandlerFunc, path string, query url.Values) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("role", common.RoleAdminUser)
	ctx.Request = httptest.NewRequest(http.MethodGet, path+"?"+query.Encode(), nil)
	handler(ctx)
	return recorder
}

func decodeUserModelUsage(t *testing.T, recorder *httptest.ResponseRecorder) userModelUsageResponse {
	t.Helper()
	require.Equal(t, http.StatusOK, recorder.Code)
	var payload userModelUsageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	require.True(t, payload.Success, payload.Message)
	return payload
}

// userModelUsageTimeQuery spans one day: 1000 floors to bucket 0 and 87400
// ceils to the exclusive end 90000.
func userModelUsageTimeQuery() url.Values {
	return url.Values{
		"start_timestamp": {"1000"},
		"end_timestamp":   {"87400"},
	}
}

func TestGetUserModelUsageGroupsByUserAndModel(t *testing.T) {
	db := setupUserModelUsageTestDB(t)
	seedUserModelUsage(t, db,
		// A renamed user keeps one row per recorded username but a single group.
		model.QuotaData{UserID: 1, Username: "former", ModelName: "gpt-a", UseGroup: "default", CreatedAt: 3600, TokenUsed: 10, CacheReadTokens: 3, CacheCreationTokens: 2, Quota: 100},
		model.QuotaData{UserID: 1, Username: "current", ModelName: "gpt-a", UseGroup: "vip", CreatedAt: 3600, TokenUsed: 20, CacheReadTokens: 4, CacheCreationTokens: 1, Quota: 200},
		// A model that exists only in history, never in the model catalog.
		model.QuotaData{UserID: 2, Username: "bob", ModelName: "retired-model", UseGroup: "default", TokenUsed: 5, Quota: 50},
		// An ungrouped row is counted whenever no group filter is set.
		model.QuotaData{UserID: 2, Username: "bob", ModelName: "gpt-b", UseGroup: "", CreatedAt: 3600, TokenUsed: 7, Quota: 70},
		// A bucket starting exactly at the exclusive end is not reported.
		model.QuotaData{UserID: 2, Username: "bob", ModelName: "gpt-b", UseGroup: "default", CreatedAt: 90000, TokenUsed: 1000, Quota: 1000},
	)

	payload := decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", userModelUsageTimeQuery()))
	require.Len(t, payload.Data.Items, 3)
	assert.EqualValues(t, 3, payload.Data.Total)
	assert.Equal(t, 1, payload.Data.Page)
	assert.Equal(t, common.ItemsPerPage, payload.Data.PageSize)

	assert.EqualValues(t, 1, payload.Data.Items[0].UserID)
	assert.Equal(t, "gpt-a", payload.Data.Items[0].ModelName)
	assert.EqualValues(t, 300, payload.Data.Items[0].Quota)
	assert.EqualValues(t, 30, payload.Data.Items[0].TokenUsed)
	assert.EqualValues(t, 7, payload.Data.Items[0].CacheReadTokens)
	assert.EqualValues(t, 3, payload.Data.Items[0].CacheCreationTokens)
	assert.Contains(t, []string{"current", "former"}, payload.Data.Items[0].Username, "a merged group shows one recorded username")

	assert.Equal(t, model.UserModelUsageRow{UserID: 2, Username: "bob", ModelName: "gpt-b", TokenUsed: 7, Quota: 70}, payload.Data.Items[1])
	assert.Equal(t, model.UserModelUsageRow{UserID: 2, Username: "bob", ModelName: "retired-model", TokenUsed: 5, Quota: 50}, payload.Data.Items[2])

	assert.Equal(t, model.UserModelUsageSummary{TokenUsed: 42, CacheReadTokens: 7, CacheCreationTokens: 3, Quota: 420}, payload.Data.Summary)
}

func TestGetUserModelUsageMergesUserIDAcrossRenames(t *testing.T) {
	db := setupUserModelUsageTestDB(t)
	seedUserModelUsage(t, db,
		model.QuotaData{UserID: 9, Username: "old-name", ModelName: "gpt-a", UseGroup: "default", TokenUsed: 1, Quota: 10},
		model.QuotaData{UserID: 9, Username: "new-name", ModelName: "gpt-a", UseGroup: "default", TokenUsed: 2, Quota: 20},
		model.QuotaData{UserID: 10, Username: "old-name", ModelName: "gpt-a", UseGroup: "default", TokenUsed: 4, Quota: 40},
	)

	payload := decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", userModelUsageTimeQuery()))
	require.Len(t, payload.Data.Items, 2)
	assert.Equal(t, 10, payload.Data.Items[0].UserID)
	assert.Equal(t, 9, payload.Data.Items[1].UserID)
	assert.EqualValues(t, 3, payload.Data.Items[1].TokenUsed)
	// MAX(username) is deterministic but may be either historical name.
	assert.Equal(t, "old-name", payload.Data.Items[1].Username)

	// An exact historical username selects only rows recorded under that name,
	// even though both names belong to the same user ID.
	query := userModelUsageTimeQuery()
	query.Set("username", "new-name")
	payload = decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
	require.Len(t, payload.Data.Items, 1)
	assert.Equal(t, 9, payload.Data.Items[0].UserID)
	assert.EqualValues(t, 2, payload.Data.Items[0].TokenUsed)

	// Both provided together combine with AND.
	query.Set("user_id", "9")
	payload = decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
	require.Len(t, payload.Data.Items, 1)
	assert.EqualValues(t, 2, payload.Data.Items[0].TokenUsed)

	// A mismatched pair returns nothing.
	query.Set("user_id", "10")
	payload = decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
	assert.Empty(t, payload.Data.Items)
	assert.EqualValues(t, 0, payload.Data.Total)
}

func TestGetUserModelUsageFiltersCombineWithinAndAcrossDimensions(t *testing.T) {
	db := setupUserModelUsageTestDB(t)
	seedUserModelUsage(t, db,
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-a", UseGroup: "default", Quota: 10},
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-a", UseGroup: "vip", Quota: 20},
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-b", UseGroup: "vip", Quota: 40},
		model.QuotaData{UserID: 2, Username: "bob", ModelName: "gpt-c", UseGroup: "vip", Quota: 80},
		// The ungrouped row is only selected by name, never by an empty group.
		model.QuotaData{UserID: 3, Username: "carol", ModelName: "gpt-d", UseGroup: "", Quota: 5},
	)

	cases := []struct {
		name   string
		query  url.Values
		models []string
		quota  int64
	}{
		{name: "no filter includes all rows", query: nil, models: []string{"gpt-a", "gpt-b", "gpt-c", "gpt-d"}, quota: 155},
		{name: "single model", query: url.Values{"model": {"gpt-a"}}, models: []string{"gpt-a"}, quota: 30},
		{name: "models are OR", query: url.Values{"model": {"gpt-a", "gpt-b"}}, models: []string{"gpt-a", "gpt-b"}, quota: 70},
		{name: "groups are OR", query: url.Values{"group": {"default", "vip"}}, models: []string{"gpt-a", "gpt-b", "gpt-c"}, quota: 150},
		{name: "models AND groups", query: url.Values{"model": {"gpt-a", "gpt-b"}, "group": {"vip"}}, models: []string{"gpt-a", "gpt-b"}, quota: 60},
		{name: "duplicate values dedupe", query: url.Values{"model": {"gpt-a", "gpt-a"}}, models: []string{"gpt-a"}, quota: 30},
		{name: "unknown value is empty", query: url.Values{"model": {"missing"}}, models: []string{}, quota: 0},
		{name: "blank group is not a filter", query: url.Values{"group": {""}}, models: []string{"gpt-a", "gpt-b", "gpt-c", "gpt-d"}, quota: 155},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			query := userModelUsageTimeQuery()
			for key, values := range tc.query {
				for _, value := range values {
					query.Add(key, value)
				}
			}
			payload := decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
			got := make([]string, 0, len(payload.Data.Items))
			for _, item := range payload.Data.Items {
				got = append(got, item.ModelName)
			}
			assert.ElementsMatch(t, tc.models, got)
			assert.Equal(t, tc.quota, payload.Data.Summary.Quota)
		})
	}
}

func TestGetUserModelUsageWindowUsesOverlappingHourlyBuckets(t *testing.T) {
	db := setupUserModelUsageTestDB(t)
	seedUserModelUsage(t, db,
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: 3600, Quota: 10},
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: 7200, Quota: 20},
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: 10800, Quota: 40},
	)
	ask := func(start, end int64) int64 {
		query := url.Values{
			"start_timestamp": {strconv.FormatInt(start, 10)},
			"end_timestamp":   {strconv.FormatInt(end, 10)},
		}
		return decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query)).Data.Summary.Quota
	}

	assert.EqualValues(t, 10, ask(3700, 7200), "a mid-hour start floors to its bucket and an exact-hour end excludes that bucket")
	assert.EqualValues(t, 30, ask(3700, 7201), "one second past the hour includes the next bucket")
	assert.EqualValues(t, 20, ask(7200, 10800), "an exact-hour start includes its own bucket")
	assert.EqualValues(t, 70, ask(3600, 10801), "a start on the hour and end inside the last bucket cover all three")
	assert.EqualValues(t, 20, ask(7201, 10800), "the end bucket is exclusive: the start floors into it but its own rows are outside")
}

func TestGetUserModelUsagePaginatesButSummarizesEveryRow(t *testing.T) {
	db := setupUserModelUsageTestDB(t)
	for i := range 5 {
		seedUserModelUsage(t, db, model.QuotaData{
			UserID:    i + 1,
			Username:  fmt.Sprintf("user-%d", i+1),
			ModelName: "gpt-a",
			Quota:     (i + 1) * 10,
			TokenUsed: i + 1,
		})
	}

	query := userModelUsageTimeQuery()
	query.Set("p", "2")
	query.Set("page_size", "2")
	payload := decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
	assert.EqualValues(t, 5, payload.Data.Total)
	assert.Equal(t, 2, payload.Data.Page)
	assert.Equal(t, 2, payload.Data.PageSize)
	require.Len(t, payload.Data.Items, 2)
	assert.Equal(t, 3, payload.Data.Items[0].UserID)
	assert.Equal(t, 2, payload.Data.Items[1].UserID)
	assert.Equal(t, model.UserModelUsageSummary{TokenUsed: 15, Quota: 150}, payload.Data.Summary)

	// A page past the end still reports the total and summary of every row.
	query.Set("p", "9")
	payload = decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
	assert.Empty(t, payload.Data.Items)
	assert.EqualValues(t, 5, payload.Data.Total)
	assert.EqualValues(t, 150, payload.Data.Summary.Quota)
}

func TestGetUserModelUsageEmptyResultHasZeroSummary(t *testing.T) {
	db := setupUserModelUsageTestDB(t)
	seedUserModelUsage(t, db, model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-a", Quota: 10})

	query := userModelUsageTimeQuery()
	query.Set("model", "nope")
	recorder := runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query)
	payload := decodeUserModelUsage(t, recorder)
	assert.Empty(t, payload.Data.Items)
	assert.EqualValues(t, 0, payload.Data.Total)
	assert.Equal(t, model.UserModelUsageSummary{}, payload.Data.Summary)
	assert.Contains(t, recorder.Body.String(), `"items":[]`)
}

func TestGetUserModelUsageRejectsInvalidInputs(t *testing.T) {
	setupUserModelUsageTestDB(t)
	tooManyModels := url.Values{}
	for i := range 51 {
		tooManyModels.Add("model", fmt.Sprintf("model-%d", i))
	}
	futureStart := common.GetTimestamp() + 86400
	maxRangeDays := operation_setting.GetLogSetting().MaxRangeSeconds() / (24 * 60 * 60)
	longRangeStart := int64(1000)
	longRangeEnd := longRangeStart + (maxRangeDays+1)*24*3600

	cases := []struct {
		name    string
		handler gin.HandlerFunc
		path    string
		query   url.Values
		message string
	}{
		{name: "missing start", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"end_timestamp": {"2000"}}, message: "Invalid parameters"},
		{name: "zero start", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"0"}, "end_timestamp": {"2000"}}, message: "Invalid parameters"},
		{name: "missing end", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}}, message: "Invalid parameters"},
		{name: "non numeric end", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"soon"}}, message: "Invalid parameters"},
		{name: "end before start", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"5000"}, "end_timestamp": {"4000"}}, message: "Invalid parameters"},
		{name: "end equals start", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"5000"}, "end_timestamp": {"5000"}}, message: "End time must be after start time"},
		{name: "future start", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {strconv.FormatInt(futureStart, 10)}, "end_timestamp": {strconv.FormatInt(futureStart+864000, 10)}}, message: "End time must be after start time"},
		{name: "range too long", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {strconv.FormatInt(longRangeStart, 10)}, "end_timestamp": {strconv.FormatInt(longRangeEnd, 10)}}, message: fmt.Sprintf("The time range cannot exceed %d days", maxRangeDays)},
		{name: "invalid user id", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "user_id": {"-1"}}, message: "Invalid user ID"},
		{name: "zero user id", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "user_id": {"0"}}, message: "Invalid user ID"},
		{name: "huge page", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "p": {"9223372036854775807"}}, message: "Invalid parameters"},
		{name: "zero page", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "p": {"0"}}, message: "Invalid parameters"},
		{name: "zero page size", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "page_size": {"0"}}, message: "Invalid parameters"},
		{name: "page size over cap", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "page_size": {"101"}}, message: "Invalid parameters"},
		{name: "deep offset", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "p": {"100002"}}, message: "Invalid parameters"},
		{name: "too many models", handler: GetUserModelUsage, path: "/api/data/user-models", query: withQuery(url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}}, tooManyModels), message: "Invalid parameters"},
		{name: "model too long", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "model": {strings.Repeat("m", 65)}}, message: "Invalid parameters"},
		{name: "username too long", handler: GetUserModelUsage, path: "/api/data/user-models", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "username": {strings.Repeat("u", 65)}}, message: "Invalid parameters"},
		{name: "missing kind", handler: GetUserModelUsageOptions, path: "/api/data/user-models/options", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}}, message: "Invalid parameters"},
		{name: "unknown kind", handler: GetUserModelUsageOptions, path: "/api/data/user-models/options", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "kind": {"token"}}, message: "Invalid parameters"},
		{name: "search too long", handler: GetUserModelUsageOptions, path: "/api/data/user-models/options", query: url.Values{"start_timestamp": {"1000"}, "end_timestamp": {"2000"}, "kind": {"model"}, "q": {strings.Repeat("q", 65)}}, message: "Invalid parameters"},
		{name: "options reject invalid range", handler: GetUserModelUsageOptions, path: "/api/data/user-models/options", query: url.Values{"start_timestamp": {"5000"}, "end_timestamp": {"4000"}, "kind": {"model"}}, message: "Invalid parameters"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := runUserModelUsageRequest(t, tc.handler, tc.path, tc.query)
			require.Equal(t, http.StatusOK, recorder.Code)
			var payload struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
			assert.False(t, payload.Success)
			assert.Equal(t, tc.message, payload.Message)
		})
	}
}

func withQuery(base url.Values, extra url.Values) url.Values {
	for key, values := range extra {
		for _, value := range values {
			base.Add(key, value)
		}
	}
	return base
}

func TestGetUserModelUsageOptionsListsRecordedNames(t *testing.T) {
	db := setupUserModelUsageTestDB(t)
	seedUserModelUsage(t, db,
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-b", UseGroup: "vip", Quota: 10},
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "GPT-A", UseGroup: "default", Quota: 20},
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-a", UseGroup: "", Quota: 20},
		model.QuotaData{UserID: 1, Username: "alice", ModelName: "", UseGroup: "", Quota: 20},
	)

	options := func(query url.Values) []string {
		recorder := runUserModelUsageRequest(t, GetUserModelUsageOptions, "/api/data/user-models/options", query)
		require.Equal(t, http.StatusOK, recorder.Code)
		var payload userModelUsageOptionsResponse
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
		require.True(t, payload.Success, payload.Message)
		return payload.Data
	}

	query := userModelUsageTimeQuery()
	query.Set("kind", "model")
	// Model and group selections of the list must not narrow the options.
	query.Add("model", "gpt-b")
	query.Add("group", "vip")
	assert.Equal(t, []string{"GPT-A", "gpt-a", "gpt-b"}, options(query), "names are sorted, distinct and nonempty")

	query.Set("q", "gPt")
	assert.Equal(t, []string{"GPT-A", "gpt-a", "gpt-b"}, options(query), "search is a case-insensitive substring")

	query.Set("q", "a")
	assert.Equal(t, []string{"GPT-A", "gpt-a"}, options(query))

	query.Set("q", "%")
	assert.Empty(t, options(query), "wildcards are matched literally")

	groupQuery := userModelUsageTimeQuery()
	groupQuery.Set("kind", "group")
	groupQuery.Add("model", "gpt-b")
	assert.Equal(t, []string{"default", "vip"}, options(groupQuery), "empty recorded groups are omitted")

	groupQuery.Set("q", "v")
	assert.Equal(t, []string{"vip"}, options(groupQuery))

	// Options are limited so a long history cannot flood a selector.
	for i := range 60 {
		seedUserModelUsage(t, db, model.QuotaData{UserID: 1, Username: "alice", ModelName: fmt.Sprintf("filler-%02d", i)})
	}
	assert.Len(t, options(userModelUsageTimeQueryWithKind("model")), 50)
}

func userModelUsageTimeQueryWithKind(kind string) url.Values {
	query := userModelUsageTimeQuery()
	query.Set("kind", kind)
	return query
}

// TestGetUserModelUsageDatabaseMatrix runs the same contract on real SQLite,
// MySQL and PostgreSQL. Set TEST_MYSQL_DSN and TEST_POSTGRES_DSN to include the
// server engines; newAuditTestDatabase provisions an isolated database.
func TestGetUserModelUsageDatabaseMatrix(t *testing.T) {
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			var db *gorm.DB
			if dialect.kind == "sqlite" {
				db = setupUserModelUsageTestDB(t)
			} else {
				if os.Getenv(dialect.env) == "" {
					t.Skip("set " + dialect.env + " to run this database")
				}
				previousDB, previousLogDB := model.DB, model.LOG_DB
				previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
				db, _ = newAuditTestDatabase(t, dialect.kind, os.Getenv(dialect.env))
				model.DB, model.LOG_DB = db, db
				common.SetDatabaseTypes(common.DatabaseType(dialect.kind), common.DatabaseType(dialect.kind))
				t.Cleanup(func() {
					require.NoError(t, db.Migrator().DropTable(&model.QuotaData{}))
					model.DB, model.LOG_DB = previousDB, previousLogDB
					common.SetDatabaseTypes(previousMain, previousLog)
				})
			}
			require.NoError(t, db.AutoMigrate(&model.QuotaData{}))
			var version string
			versionQuery := "SELECT version()"
			if dialect.kind == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("%s version: %s", dialect.kind, version)

			seedUserModelUsage(t, db,
				model.QuotaData{UserID: 1, Username: "Alice", ModelName: "Model-X", UseGroup: "VIP", CreatedAt: 3600, TokenUsed: 5, CacheReadTokens: 1, Quota: 30},
				model.QuotaData{UserID: 1, Username: "Alice", ModelName: "model-x", UseGroup: "vip", CreatedAt: 3600, TokenUsed: 7, CacheReadTokens: 2, Quota: 40},
				model.QuotaData{UserID: 2, Username: "bob", ModelName: "Model-X", UseGroup: "default", CreatedAt: 7200, TokenUsed: 11, Quota: 60},
			)

			payload := decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", userModelUsageTimeQuery()))
			require.Len(t, payload.Data.Items, 3, "case-distinct model names stay separate")
			assert.EqualValues(t, 3, payload.Data.Total)
			assert.Equal(t, model.UserModelUsageSummary{TokenUsed: 23, CacheReadTokens: 3, Quota: 130}, payload.Data.Summary)

			// Filtering by one exact model selects only its own recorded rows.
			query := userModelUsageTimeQuery()
			query.Set("model", "model-x")
			payload = decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
			require.Len(t, payload.Data.Items, 1)
			assert.Equal(t, "model-x", payload.Data.Items[0].ModelName)
			assert.EqualValues(t, 40, payload.Data.Summary.Quota)

			// The exact historical username is matched case-sensitively as well.
			query = userModelUsageTimeQuery()
			query.Set("username", "Alice")
			payload = decodeUserModelUsage(t, runUserModelUsageRequest(t, GetUserModelUsage, "/api/data/user-models", query))
			require.Len(t, payload.Data.Items, 2)
			assert.EqualValues(t, 70, payload.Data.Summary.Quota)

			query = userModelUsageTimeQueryWithKind("model")
			optionsPayload := decodeUserModelUsageOptions(t, runUserModelUsageRequest(t, GetUserModelUsageOptions, "/api/data/user-models/options", query))
			assert.Equal(t, []string{"Model-X", "model-x"}, optionsPayload, "option names keep their recorded case")

			// Case-insensitive search still finds both spellings.
			query.Set("q", "MODEL-X")
			assert.Equal(t, []string{"Model-X", "model-x"}, decodeUserModelUsageOptions(t, runUserModelUsageRequest(t, GetUserModelUsageOptions, "/api/data/user-models/options", query)))

			// A cancelled request aborts the query instead of running it.
			cancelled, cancel := context.WithCancel(context.Background())
			cancel()
			_, _, _, err := model.GetUserModelUsagePage(cancelled, model.UserModelUsageFilter{StartTimestamp: 0, EndTimestamp: 1_000_000_000}, 0, 10)
			assert.Error(t, err)
		})
	}
}

func decodeUserModelUsageOptions(t *testing.T, recorder *httptest.ResponseRecorder) []string {
	t.Helper()
	require.Equal(t, http.StatusOK, recorder.Code)
	var payload userModelUsageOptionsResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	require.True(t, payload.Success, payload.Message)
	return payload.Data
}
