import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:intl/intl.dart';

class ViewAllLeavesPage extends StatefulWidget {
  const ViewAllLeavesPage({Key? key, required Map<String, dynamic> userData}) : super(key: key);

  @override
  State<ViewAllLeavesPage> createState() => _ViewAllLeavesPageState();
}

class _ViewAllLeavesPageState extends State<ViewAllLeavesPage> {
  // Color Palette
  static const Color primaryColor = Color(0xFFFF6B35);
  // ignore: unused_field
  static const Color primaryDark = Color(0xFFE55A2B);
  static const Color backgroundColor = Color(0xFFFFFBF7);
  static const Color cardColor = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFF2D2D2D);
  static const Color textSecondary = Color(0xFF666666);
  static const Color successColor = Color(0xFF388E3C);
  static const Color accentOrange = Color(0xFFFFF3E0);
  static const Color lightBlue = Color(0xFF4FC3F7);
  static const Color lightRed = Color(0xFFEF5350);
  static const Color warningColor = Color(0xFFFF9800);

  List<Map<String, dynamic>> allLeaveRequests = [];
  Map<String, List<Map<String, dynamic>>> groupedLeaves = {};
  bool isLoading = true;
  String? errorMessage;
  String selectedFilter = 'All';
  
  // Replace with your actual API endpoint
  final String apiUrl = 'http://10.176.21.109:4000/api/leave-requests';

  @override
  void initState() {
    super.initState();
    fetchLeaveRequests();
  }

  Future<void> fetchLeaveRequests() async {
    setState(() {
      isLoading = true;
      errorMessage = null;
    });

    try {
      final response = await http.get(
        Uri.parse(apiUrl),
        headers: {
          'Content-Type': 'application/json',
          // Add authentication headers if needed
          // 'Authorization': 'Bearer your-token-here',
        },
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        setState(() {
          allLeaveRequests = data.map((item) => Map<String, dynamic>.from(item)).toList();
          groupLeavesByMonth();
          isLoading = false;
        });
      } else {
        setState(() {
          errorMessage = 'Failed to load leave requests. Status: ${response.statusCode}';
          isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        errorMessage = 'Error fetching data: $e';
        isLoading = false;
      });
    }
  }

  void groupLeavesByMonth() {
    groupedLeaves.clear();
    
    for (var leave in allLeaveRequests) {
      if (selectedFilter != 'All' && leave['status']?.toLowerCase() != selectedFilter.toLowerCase()) {
        continue;
      }
      
      String? createdAt = leave['created_at'];
      if (createdAt != null) {
        DateTime date = DateTime.parse(createdAt);
        String monthYear = DateFormat('MMMM yyyy').format(date);
        
        if (!groupedLeaves.containsKey(monthYear)) {
          groupedLeaves[monthYear] = [];
        }
        groupedLeaves[monthYear]!.add(leave);
      }
    }
    
    // Sort months in descending order (latest first)
    final sortedKeys = groupedLeaves.keys.toList()
      ..sort((a, b) {
        DateTime dateA = DateFormat('MMMM yyyy').parse(a);
        DateTime dateB = DateFormat('MMMM yyyy').parse(b);
        return dateB.compareTo(dateA);
      });
    
    Map<String, List<Map<String, dynamic>>> sortedGroupedLeaves = {};
    for (String key in sortedKeys) {
      sortedGroupedLeaves[key] = groupedLeaves[key]!;
    }
    groupedLeaves = sortedGroupedLeaves;
  }

  Color getStatusColor(String? status) {
    switch (status?.toLowerCase()) {
      case 'approved':
        return successColor;
      case 'pending':
        return warningColor;
      case 'rejected':
        return lightRed;
      default:
        return textSecondary;
    }
  }

  Icon getLeaveTypeIcon(String? leaveType) {
    switch (leaveType?.toLowerCase()) {
      case 'sick':
        return const Icon(Icons.local_hospital, color: lightRed, size: 20);
      case 'casual':
        return const Icon(Icons.weekend, color: lightBlue, size: 20);
      case 'annual':
        return const Icon(Icons.calendar_month, color: successColor, size: 20);
      case 'emergency':
        return const Icon(Icons.emergency, color: warningColor, size: 20);
      default:
        return const Icon(Icons.event_note, color: textSecondary, size: 20);
    }
  }

  String formatDate(String? dateStr) {
    if (dateStr == null) return 'N/A';
    try {
      DateTime date = DateTime.parse(dateStr);
      return DateFormat('dd MMM yyyy').format(date);
    } catch (e) {
      return dateStr;
    }
  }

  String formatTime(String? timeStr) {
    if (timeStr == null) return 'N/A';
    try {
      // Parse time string (assumes format like "09:30:00")
      List<String> parts = timeStr.split(':');
      if (parts.length >= 2) {
        int hour = int.parse(parts[0]);
        int minute = int.parse(parts[1]);
        TimeOfDay time = TimeOfDay(hour: hour, minute: minute);
        return time.format(context);
      }
      return timeStr;
    } catch (e) {
      return timeStr;
    }
  }

  Widget buildFilterChips() {
    List<String> filters = ['All', 'Pending', 'Approved', 'Rejected'];
    
    return Container(
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: filters.length,
        itemBuilder: (context, index) {
          String filter = filters[index];
          bool isSelected = selectedFilter == filter;
          
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              label: Text(filter),
              selected: isSelected,
              onSelected: (selected) {
                setState(() {
                  selectedFilter = filter;
                  groupLeavesByMonth();
                });
              },
              selectedColor: primaryColor.withOpacity(0.2),
              checkmarkColor: primaryColor,
              backgroundColor: cardColor,
              labelStyle: TextStyle(
                color: isSelected ? primaryColor : textSecondary,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          );
        },
      ),
    );
  }

  Widget buildLeaveCard(Map<String, dynamic> leave) {
    String status = leave['status'] ?? 'Unknown';
    String leaveType = leave['leave_type'] ?? 'N/A';
    String employeeName = leave['employee_name'] ?? 'N/A';
    String fromDate = formatDate(leave['from_date']);
    String toDate = formatDate(leave['to_date']);
    String reason = leave['reason'] ?? 'No reason provided';
    String outTime = formatTime(leave['out_time']);
    String inTime = formatTime(leave['in_time']);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: cardColor,
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header Row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Row(
                    children: [
                      getLeaveTypeIcon(leaveType),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          employeeName,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: textPrimary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: getStatusColor(status).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: getStatusColor(status), width: 1),
                  ),
                  child: Text(
                    status.toUpperCase(),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: getStatusColor(status),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            
            // Leave Type & Duration
            Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: accentOrange,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Leave Type',
                          style: TextStyle(
                            fontSize: 12,
                            color: textSecondary,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        Text(
                          leaveType.toUpperCase(),
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: lightBlue.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Duration',
                          style: TextStyle(
                            fontSize: 12,
                            color: textSecondary,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        Text(
                          '$fromDate - $toDate',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            
            // Times (if available)
            if (leave['out_time'] != null || leave['in_time'] != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  if (leave['out_time'] != null)
                    Expanded(
                      child: Row(
                        children: [
                          Icon(Icons.logout, size: 16, color: textSecondary),
                          const SizedBox(width: 4),
                          Text(
                            'Out: $outTime',
                            style: TextStyle(fontSize: 12, color: textSecondary),
                          ),
                        ],
                      ),
                    ),
                  if (leave['in_time'] != null)
                    Expanded(
                      child: Row(
                        children: [
                          Icon(Icons.login, size: 16, color: textSecondary),
                          const SizedBox(width: 4),
                          Text(
                            'In: $inTime',
                            style: TextStyle(fontSize: 12, color: textSecondary),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ],
            
            // Reason
            const SizedBox(height: 8),
            Text(
              'Reason:',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: textSecondary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              reason,
              style: const TextStyle(
                fontSize: 14,
                color: textPrimary,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            
            // Remarks (if available)
            if (leave['remarks'] != null && leave['remarks'].toString().isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: backgroundColor,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Remarks:',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: textSecondary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      leave['remarks'],
                      style: const TextStyle(
                        fontSize: 12,
                        color: textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget buildMonthSection(String month, List<Map<String, dynamic>> leaves) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          margin: const EdgeInsets.only(top: 16, bottom: 8),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [primaryColor.withOpacity(0.1), primaryColor.withOpacity(0.05)],
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                month,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: primaryColor,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: primaryColor,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '${leaves.length} ${leaves.length == 1 ? 'Request' : 'Requests'}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
        ...leaves.map((leave) => buildLeaveCard(leave)).toList(),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        title: const Text(
          'All Leave Requests',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        backgroundColor: primaryColor,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: fetchLeaveRequests,
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter Chips
          buildFilterChips(),
          
          // Content
          Expanded(
            child: isLoading
                ? const Center(
                    child: CircularProgressIndicator(
                      valueColor: AlwaysStoppedAnimation<Color>(primaryColor),
                    ),
                  )
                : errorMessage != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.error_outline,
                              size: 64,
                              color: lightRed,
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'Error Loading Data',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                                color: textPrimary,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 32),
                              child: Text(
                                errorMessage!,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: textSecondary,
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: fetchLeaveRequests,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: primaryColor,
                                foregroundColor: Colors.white,
                              ),
                              child: const Text('Retry'),
                            ),
                          ],
                        ),
                      )
                    : groupedLeaves.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.inbox_outlined,
                                  size: 64,
                                  color: textSecondary,
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  'No Leave Requests Found',
                                  style: TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w600,
                                    color: textPrimary,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'There are no leave requests matching your filter.',
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: fetchLeaveRequests,
                            color: primaryColor,
                            child: ListView.builder(
                              itemCount: groupedLeaves.keys.length,
                              itemBuilder: (context, index) {
                                String month = groupedLeaves.keys.elementAt(index);
                                List<Map<String, dynamic>> leaves = groupedLeaves[month]!;
                                return buildMonthSection(month, leaves);
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}