package controller

import (
	"strconv"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const (
	userModelUsageMaxFilterValues = 50
	userModelUsageMaxValueLength  = 64
	userModelUsageMaxPageSize     = 100
	userModelUsageMaxOffset       = 1_000_000
	userModelUsageOptionsLimit    = 50
)

// parseUserModelUsageFilters reads the time range and optional user filters
// shared by the usage list and its option lists. The range selects recorded
// hourly buckets that overlap it: the start is floored to its hour and the end
// is exclusive, so a bucket starting exactly at the end hour is not recorded.
// It writes the error response and returns false when the query is invalid.
func parseUserModelUsageFilters(c *gin.Context) (model.UserModelUsageFilter, bool) {
	var filter model.UserModelUsageFilter
	startTimestamp, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || startTimestamp <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return filter, false
	}
	endTimestamp, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || endTimestamp <= 0 || endTimestamp < startTimestamp {
		common.ApiErrorT(c, "Invalid parameters")
		return filter, false
	}
	if _, err := limitLogTimeRange(startTimestamp, endTimestamp); err != nil {
		common.ApiError(c, err)
		return filter, false
	}
	effectiveEnd := min(common.GetTimestamp(), endTimestamp)
	if effectiveEnd <= startTimestamp {
		// A range that starts in the future (or ends before it starts) has no
		// recorded bucket; clamp the end to now only when now is after start.
		common.ApiErrorT(c, "End time must be after start time")
		return filter, false
	}
	filter.StartTimestamp = startTimestamp - startTimestamp%3600
	filter.EndTimestamp = (effectiveEnd + 3599) / 3600 * 3600

	username := c.Query("username")
	if username != "" {
		if utf8.RuneCountInString(username) > userModelUsageMaxValueLength {
			common.ApiErrorT(c, "Invalid parameters")
			return filter, false
		}
		filter.Username = username
	}
	if raw := c.Query("user_id"); raw != "" {
		userID, err := strconv.Atoi(raw)
		if err != nil || userID <= 0 {
			common.ApiErrorT(c, "Invalid user ID")
			return filter, false
		}
		filter.UserID = userID
	}
	return filter, true
}

// boundedUserModelUsageValues validates repeated filter values and drops empty
// and duplicate entries so a model or group is selected at most once.
func boundedUserModelUsageValues(values []string) ([]string, bool) {
	if len(values) == 0 {
		return nil, true
	}
	if len(values) > userModelUsageMaxFilterValues {
		return nil, false
	}
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > userModelUsageMaxValueLength {
			return nil, false
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique, true
}

// parseUserModelUsagePage reads p and page_size and keeps the offset small
// enough that page arithmetic cannot overflow.
func parseUserModelUsagePage(c *gin.Context) (int, int, bool) {
	page := 1
	if raw := c.Query("p"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			common.ApiErrorT(c, "Invalid parameters")
			return 0, 0, false
		}
		page = parsed
	}
	pageSize := common.ItemsPerPage
	if raw := c.Query("page_size"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 || parsed > userModelUsageMaxPageSize {
			common.ApiErrorT(c, "Invalid parameters")
			return 0, 0, false
		}
		pageSize = parsed
	}
	if (page - 1) > userModelUsageMaxOffset/pageSize {
		common.ApiErrorT(c, "Invalid parameters")
		return 0, 0, false
	}
	return page, pageSize, true
}

// GetUserModelUsage reports recorded usage per user ID and model. The summary
// covers every filtered row, while items only cover the requested page.
func GetUserModelUsage(c *gin.Context) {
	filter, ok := parseUserModelUsageFilters(c)
	if !ok {
		return
	}
	filter.Models, ok = boundedUserModelUsageValues(c.QueryArray("model"))
	if !ok {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	filter.Groups, ok = boundedUserModelUsageValues(c.QueryArray("group"))
	if !ok {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	page, pageSize, ok := parseUserModelUsagePage(c)
	if !ok {
		return
	}
	items, total, summary, err := model.GetUserModelUsagePage(c.Request.Context(), filter, (page-1)*pageSize, pageSize)
	if err != nil {
		common.SysError(common.LogText("failed to query user model usage: %s", err.Error()))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	if items == nil {
		items = []model.UserModelUsageRow{}
	}
	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"summary":   summary,
	})
}

// GetUserModelUsageOptions lists recorded model or group names for the same
// time and user filters. The current model and group selections are ignored so
// the two selectors cannot filter each other out; the caller clears them here.
func GetUserModelUsageOptions(c *gin.Context) {
	filter, ok := parseUserModelUsageFilters(c)
	if !ok {
		return
	}
	kind := c.Query("kind")
	if kind != "model" && kind != "group" {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	search := c.Query("q")
	if utf8.RuneCountInString(search) > userModelUsageMaxValueLength {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	filter.Models = nil
	filter.Groups = nil
	options, err := model.GetUserModelUsageOptions(c.Request.Context(), filter, kind, search, userModelUsageOptionsLimit)
	if err != nil {
		common.SysError(common.LogText("failed to query user model usage options: %s", err.Error()))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	if options == nil {
		options = []string{}
	}
	common.ApiSuccess(c, options)
}
