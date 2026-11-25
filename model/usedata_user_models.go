package model

import (
	"context"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// UserModelUsageFilter selects recorded dashboard usage in hourly buckets.
// StartTimestamp is the first included bucket and EndTimestamp the first
// excluded one, so a bucket overlaps the requested time range when
// StartTimestamp <= created_at < EndTimestamp.
type UserModelUsageFilter struct {
	StartTimestamp int64
	EndTimestamp   int64
	Username       string
	UserID         int
	Models         []string
	Groups         []string
}

type UserModelUsageRow struct {
	UserID              int    `json:"user_id" gorm:"column:user_id"`
	Username            string `json:"username" gorm:"column:username"`
	ModelName           string `json:"model_name" gorm:"column:model_name"`
	TokenUsed           int64  `json:"token_used" gorm:"column:token_used"`
	CacheReadTokens     int64  `json:"cache_read_tokens" gorm:"column:cache_read_tokens"`
	CacheCreationTokens int64  `json:"cache_creation_tokens" gorm:"column:cache_creation_tokens"`
	Quota               int64  `json:"quota" gorm:"column:quota"`
}

type UserModelUsageSummary struct {
	TokenUsed           int64 `json:"token_used" gorm:"column:token_used"`
	CacheReadTokens     int64 `json:"cache_read_tokens" gorm:"column:cache_read_tokens"`
	CacheCreationTokens int64 `json:"cache_creation_tokens" gorm:"column:cache_creation_tokens"`
	Quota               int64 `json:"quota" gorm:"column:quota"`
}

// userModelUsageTextExpr keeps recorded text identities case-sensitive on
// MySQL. Its default collation folds case-distinct names such as "GPT-A" and
// "gpt-a" into one group, while the gateway treats usernames, group names and
// model names as distinct strings. Other engines compare text case-sensitively
// by default. No index or schema change is involved: the expression only
// affects comparison, grouping and ordering in this report.
func userModelUsageTextExpr(column string) string {
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return "BINARY " + column
	}
	return column
}

func userModelUsageQuery(ctx context.Context, filter UserModelUsageFilter) *gorm.DB {
	query := DB.WithContext(ctx).
		Table("quota_data").
		Where("created_at >= ? and created_at < ?", filter.StartTimestamp, filter.EndTimestamp)
	if filter.Username != "" {
		query = query.Where(userModelUsageTextExpr("username")+" = ?", filter.Username)
	}
	if filter.UserID > 0 {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if len(filter.Models) > 0 {
		query = query.Where(userModelUsageTextExpr("model_name")+" IN ?", filter.Models)
	}
	if len(filter.Groups) > 0 {
		query = query.Where(userModelUsageTextExpr("use_group")+" IN ?", filter.Groups)
	}
	return query
}

// GetUserModelUsagePage returns one page of recorded usage grouped by user ID
// and model name, the total number of such pairs, and the summary of every
// filtered row (not only the returned page). Usernames and model names come
// from the recorded rows, so renames and deleted users or models stay visible.
func GetUserModelUsagePage(ctx context.Context, filter UserModelUsageFilter, offset int, limit int) ([]UserModelUsageRow, int64, UserModelUsageSummary, error) {
	summary := UserModelUsageSummary{}
	if limit <= 0 {
		limit = common.ItemsPerPage
	}
	if offset < 0 {
		offset = 0
	}
	modelExpr := userModelUsageTextExpr("model_name")
	pairQuery := userModelUsageQuery(ctx, filter).
		Select("user_id, " + modelExpr + " as model_key").
		Group("user_id, " + modelExpr)
	var total int64
	if err := DB.WithContext(ctx).Table("(?) as user_model_pairs", pairQuery).Count(&total).Error; err != nil {
		return nil, 0, summary, err
	}

	items := make([]UserModelUsageRow, 0)
	// MAX(username) picks one recorded username deterministically when a user
	// ID carries several historical names; it is not necessarily the latest.
	err := userModelUsageQuery(ctx, filter).
		Select("user_id, MAX(username) as username, " + modelExpr + " as model_name, " +
			"SUM(token_used) as token_used, SUM(cache_read_tokens) as cache_read_tokens, " +
			"SUM(cache_creation_tokens) as cache_creation_tokens, SUM(quota) as quota").
		Group("user_id, " + modelExpr).
		Order("quota DESC, user_id ASC, model_name ASC").
		Offset(offset).
		Limit(limit).
		Scan(&items).Error
	if err != nil {
		return nil, 0, summary, err
	}

	err = userModelUsageQuery(ctx, filter).
		Select("COALESCE(SUM(token_used), 0) as token_used, " +
			"COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens, " +
			"COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens, " +
			"COALESCE(SUM(quota), 0) as quota").
		Scan(&summary).Error
	if err != nil {
		return nil, 0, summary, err
	}
	return items, total, summary, nil
}

// GetUserModelUsageOptions lists distinct recorded model or group names for the
// same time and user filters. The caller must not pass model or group
// selections: the selectors must not filter each other out. Only nonempty names
// that actually occur in the recorded rows are returned.
func GetUserModelUsageOptions(ctx context.Context, filter UserModelUsageFilter, kind string, search string, limit int) ([]string, error) {
	column := "model_name"
	if kind == "group" {
		column = "use_group"
	}
	columnExpr := userModelUsageTextExpr(column)
	if limit <= 0 {
		limit = 50
	}
	query := userModelUsageQuery(ctx, filter).Where(columnExpr + " <> ''")
	if search != "" {
		// Search stays case-insensitive on every engine, so it must not use the
		// binary expression that keeps recorded names distinct.
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(search) + "%"
		query = query.Where("LOWER("+column+") LIKE LOWER(?) ESCAPE '!'", pattern)
	}
	var rows []struct {
		Name string `gorm:"column:name"`
	}
	err := query.
		Select("MAX(" + columnExpr + ") as name").
		Group(columnExpr).
		Order(columnExpr + " ASC").
		Limit(limit).
		Scan(&rows).Error
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		names = append(names, row.Name)
	}
	// Sort in Go so the order does not depend on the engine collation.
	slices.Sort(names)
	return names, err
}
